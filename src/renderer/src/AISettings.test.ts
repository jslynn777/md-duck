import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import type { AISettings as AISettingsValue } from '../../shared/ai'
import { AISettings } from './AISettings'

// Exercise the real form handlers with in-memory hooks and mocked IPC, without keys or networking.
const hooks = vi.hoisted(() => ({
  cursor: 0, slots: [] as unknown[], effects: [] as Array<() => unknown>,
  dependencies: new Map<number, unknown[]>(), cleanups: [] as Array<() => void>
}))
vi.mock('react', () => ({
  useId: () => 'ai-settings-test',
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = initial
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next }]
  },
  useRef: (current: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = { current }
    return hooks.slots[index]
  },
  useEffect: (effect: () => (() => void) | void, dependencies: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.dependencies.get(index)
    if (previous && dependencies.length === previous.length && dependencies.every((item, at) => Object.is(item, previous[at]))) return
    hooks.dependencies.set(index, dependencies)
    hooks.effects.push(() => { const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup) })
  }
}))
vi.mock('@shared/ai', async () => await import('../../shared/ai'))

function initial(): AISettingsValue {
  return {
    provider: 'openrouter',
    profiles: {
      openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini', hasKey: true, status: 'untested' },
      deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', hasKey: false, status: 'unconfigured' },
      custom: { baseUrl: '', model: '', hasKey: false, status: 'unconfigured' }
    }
  }
}

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>
let value: AISettingsValue
let tree: Node
let ui: 'en' | 'zh'
const draft = vi.fn()
const api = {
  saveAISettings: vi.fn(), testAIConnection: vi.fn(), getAISettings: vi.fn(),
  openExternal: vi.fn(), cancelAIAuth: vi.fn(), connectOpenRouter: vi.fn()
}

function render() {
  hooks.cursor = 0
  tree = AISettings({ value, ui, onChange: (next) => { value = next }, onDraftStateChange: draft }) as Node
  hooks.effects.splice(0).forEach((effect) => effect())
}
function all(node: ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(all)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as Node
  return [element, ...all(element.props.children)]
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return node && typeof node === 'object' && 'props' in node ? text((node as Node).props.children) : ''
}
function button(label: string) {
  const result = all(tree).find((node) => node.type === 'button' && text(node.props.children) === label)
  if (!result) throw new Error(`Button not found: ${label}`)
  return result
}
function input(suffix: string) {
  const result = all(tree).find((node) => node.props.id === `ai-settings-test-${suffix}`)
  if (!result) throw new Error(`Input not found: ${suffix}`)
  return result
}
function change(suffix: string, next: string) {
  (input(suffix).props.onChange as (event: unknown) => void)({ target: { value: next } })
  render()
}
function click(label: string) { (button(label).props.onClick as () => void)() }

beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dependencies.clear(); hooks.cleanups = []
  vi.clearAllMocks()
  value = initial(); ui = 'en'
  api.openExternal.mockResolvedValue(undefined)
  api.cancelAIAuth.mockResolvedValue(undefined)
  vi.stubGlobal('window', { api })
  render()
})

afterEach(() => {
  hooks.cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

describe('AI settings consent and draft state', () => {
  it('saves a changed model locally without running a paid connection test', async () => {
    change('model', 'another-model')
    expect(draft).toHaveBeenLastCalledWith({ dirty: true, busy: false })
    api.saveAISettings.mockImplementationOnce(async (config) => ({
      ...value, profiles: { ...value.profiles, openrouter: { ...value.profiles.openrouter, model: config.model } }
    }))
    click('Save AI settings')
    render()
    expect(draft).toHaveBeenLastCalledWith({ dirty: true, busy: true })
    await Promise.resolve()
    render()
    expect(api.saveAISettings).toHaveBeenCalledWith({ provider: 'openrouter', model: 'another-model', baseUrl: 'https://openrouter.ai/api/v1' })
    expect(api.testAIConnection).not.toHaveBeenCalled()
    expect(draft).toHaveBeenLastCalledWith({ dirty: false, busy: false })
  })

  it('tests only saved settings after an explicit Test connection action', async () => {
    api.testAIConnection.mockResolvedValueOnce({ ...value, profiles: { ...value.profiles, openrouter: { ...value.profiles.openrouter, status: 'connected' } } })
    expect(api.testAIConnection).not.toHaveBeenCalled()
    click('Test connection')
    await Promise.resolve()
    render()
    expect(api.testAIConnection).toHaveBeenCalledTimes(1)
    expect(api.saveAISettings).not.toHaveBeenCalled()
    expect(text(tree)).toContain('Connection verified.')
  })

  it('prevents testing unsaved configuration and never exposes a key in draft callbacks', () => {
    change('key', 'fixture-not-a-real-secret')
    expect(button('Test connection').props.disabled).toBe(true)
    click('Test connection')
    expect(api.testAIConnection).not.toHaveBeenCalled()
    expect(draft).toHaveBeenLastCalledWith({ dirty: true, busy: false })
    expect(JSON.stringify(draft.mock.calls)).not.toContain('fixture-not-a-real-secret')
  })

  it('retains a draft after save fails and allows editing it', async () => {
    change('model', 'another-model')
    api.saveAISettings.mockRejectedValueOnce(new Error('Could not store settings'))
    click('Save AI settings')
    await Promise.resolve()
    render()
    expect(input('model').props.value).toBe('another-model')
    expect(draft).toHaveBeenLastCalledWith({ dirty: true, busy: false })
    expect(api.testAIConnection).not.toHaveBeenCalled()
  })

  it('keeps unsaved input while deciding whether to switch providers', () => {
    change('model', 'another-model')
    change('provider', 'deepseek')
    expect(input('provider').props.value).toBe('openrouter')
    expect(text(tree)).toContain('Switching services will discard them.')
    click('Keep editing'); render()
    expect(input('model').props.value).toBe('another-model')
    change('provider', 'deepseek')
    click('Discard and switch'); render()
    expect(input('provider').props.value).toBe('deepseek')
    expect(input('model').props.value).toBe('deepseek-flash')
    expect(api.saveAISettings).not.toHaveBeenCalled()
  })

  it('opens the setup guide matching the UI language', () => {
    click('Need a key? Learn how to get one'); render()
    click('Read the setup guide')
    expect(api.openExternal).toHaveBeenLastCalledWith('https://mdduck.com/en/guide/#ai-setup')
    ui = 'zh'; render()
    click('查看设置指南')
    expect(api.openExternal).toHaveBeenLastCalledWith('https://mdduck.com/guide/#ai-setup')
  })

  it('allows closing browser authorization and cancels it on unmount', () => {
    api.connectOpenRouter.mockImplementationOnce(() => new Promise(() => undefined))
    click('Connect OpenRouter in browser'); render()
    expect(draft).toHaveBeenLastCalledWith({ dirty: false, busy: false })
    hooks.cleanups.splice(0).forEach((cleanup) => cleanup())
    expect(api.cancelAIAuth).toHaveBeenCalledTimes(1)
  })
})
