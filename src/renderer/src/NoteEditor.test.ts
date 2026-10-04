import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteEditor, type NoteEditorTarget } from './NoteEditor'

// Test modal focus and background state at the DOM boundary, without a renderer or audio device.
const hooks = vi.hoisted(() => ({ cursor: 0, effectCursor: 0, refs: [] as Array<{ current: unknown }>, effects: [] as Array<() => unknown>, dependencies: new Map<number, unknown[]>(), cleanups: [] as Array<() => void> }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useRef: (current: unknown) => {
    const index = hooks.cursor++
    if (!hooks.refs[index]) hooks.refs[index] = { current }
    return hooks.refs[index]
  },
  useEffect: (effect: () => (() => void) | void, dependencies: unknown[]) => {
    const index = hooks.effectCursor++
    const previous = hooks.dependencies.get(index)
    if (previous && previous.length === dependencies.length && dependencies.every((value, at) => Object.is(value, previous[at]))) return
    hooks.dependencies.set(index, dependencies)
    hooks.effects.push(() => { const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup) })
  }
}))
vi.mock('@shared/i18n', async () => await import('../../shared/i18n'))
vi.mock('./i18n', () => ({ useT: () => (key: string) => key }))

class Element {
  children: Element[] = []
  parentElement: Element | null = null
  inert = false
  disabled = false
  isConnected = true
  constructor(readonly kind = 'div') {}
  append(...nodes: Element[]) { this.children.push(...nodes); nodes.forEach((node) => { node.parentElement = this }) }
  contains(node: unknown): boolean { return node === this || this.children.some((child) => child.contains(node)) }
  focus() { if (!this.disabled) dom.activeElement = this }
  matches(selector: string) { return selector === ':disabled' && this.disabled }
  closest(selector: string): Element | null {
    if (selector === '[inert]' && this.inert) return this
    return this.parentElement?.closest(selector) ?? null
  }
  querySelectorAll() { return controls.filter((control) => !control.disabled) }
  querySelector() { return controls.find((control) => control.kind === 'button' && !control.disabled) }
}
const listeners = new Map<string, (event: KeyboardEvent) => void>()
const dom = {
  activeElement: null as Element | null,
  addEventListener: vi.fn((name: string, callback: (event: KeyboardEvent) => void) => { listeners.set(name, callback) }),
  removeEventListener: vi.fn((name: string) => { listeners.delete(name) })
}
let root: Element
let main: Element
let priorInert: Element
let backdrop: Element
let dialog: Element
let textarea: Element
let previous: Element
let controls: Element[]
let tree: ReactElement<{ children: ReactElement<{ onKeyDown: (event: KeyboardEvent) => void }> }>
const target: NoteEditorTarget = {
  sourcePath: '/fixture/article.md', draftKey: 'fixture-draft', quote: 'A quoted sentence.', lang: 'source',
  blockId: null, blockKey: 'fixture-block', originalComment: '', unavailable: false
}

function render(saving = false, restoring = false, error = '') {
  hooks.cursor = 0; hooks.effectCursor = 0
  tree = NoteEditor({ target, comment: 'A comment', hasDraft: true, persisted: true, saving, restoring, error,
    onComment: vi.fn(), onSave: vi.fn(), onClose: vi.fn(), onDiscard: vi.fn(), onCopy: vi.fn(), onRestore: vi.fn() }) as typeof tree
  hooks.refs[0].current = dialog
  hooks.refs[1].current = textarea
  textarea.disabled = saving
  controls.at(-1)!.disabled = saving
  hooks.effects.splice(0).forEach((effect) => effect())
}
function tab(shiftKey = false) {
  const preventDefault = vi.fn()
  const target = dom.activeElement
  const event = { key: 'Tab', shiftKey, preventDefault } as unknown as KeyboardEvent
  listeners.get('keydown')?.(event)
  // Body/background events never bubble through the modal's React handler.
  if (dialog.contains(target)) tree.props.children.props.onKeyDown(event)
  return preventDefault
}

beforeEach(() => {
  hooks.cursor = 0; hooks.effectCursor = 0; hooks.refs = []; hooks.effects = []; hooks.dependencies.clear(); hooks.cleanups = []
  listeners.clear(); vi.clearAllMocks()
  root = new Element(); main = new Element(); priorInert = new Element(); backdrop = new Element(); dialog = new Element()
  textarea = new Element('textarea'); previous = new Element('button')
  controls = [new Element('button'), textarea, new Element('button'), new Element('button')]
  main.append(previous); dialog.append(...controls); backdrop.append(dialog); root.append(main, priorInert, backdrop)
  priorInert.inert = true
  dom.activeElement = previous
  vi.stubGlobal('document', dom)
  vi.stubGlobal('HTMLElement', Element)
})
afterEach(() => {
  hooks.cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

describe('note editor modal focus', () => {
  it('makes the reader inert, enters the textarea, and restores prior inert flags and focus on close', () => {
    render()
    expect(main.inert).toBe(true)
    expect(priorInert.inert).toBe(true)
    expect(backdrop.inert).toBe(false)
    expect(dom.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    expect(dom.activeElement).toBe(textarea)
    hooks.cleanups.splice(0).forEach((cleanup) => cleanup())
    expect(main.inert).toBe(false)
    expect(priorInert.inert).toBe(true)
    expect(dom.activeElement).toBe(previous)
    expect(listeners.has('keydown')).toBe(false)
  })

  it('moves focus to an available modal button while saving disables the focused textarea', () => {
    render()
    render(true)
    expect(textarea.disabled).toBe(true)
    expect(dom.activeElement).toBe(controls[0])
  })

  it('recovers focus when disabling the input has already moved focus outside', () => {
    render()
    dom.activeElement = root
    render(true)
    expect(dom.activeElement).toBe(controls[0])
  })

  it('wraps Tab and Shift+Tab within enabled controls, including when focus starts outside', () => {
    render()
    dom.activeElement = controls.at(-1)!
    expect(tab()).toHaveBeenCalled()
    expect(dom.activeElement).toBe(controls[0])
    expect(tab(true)).toHaveBeenCalled()
    expect(dom.activeElement).toBe(controls.at(-1))
    dom.activeElement = root
    expect(tab()).toHaveBeenCalled()
    expect(dom.activeElement).toBe(controls[0])
    dom.activeElement = root
    expect(tab(true)).toHaveBeenCalled()
    expect(dom.activeElement).toBe(controls.at(-1))
  })

  it('keeps focus on an enabled modal button after saving finishes', () => {
    render()
    render(true)
    dom.activeElement = controls[2]
    render(false)
    expect(dom.activeElement).toBe(controls[2])
  })

  it('recovers focus when a cleared recovery error removes the focused restore button', () => {
    render(false, false, 'Restore the backup before saving.')
    const restoreButton = new Element('button')
    dialog.append(restoreButton)
    dom.activeElement = restoreButton
    // React removes the conditional restore button after the backup succeeds.
    dialog.children = dialog.children.filter((node) => node !== restoreButton)
    restoreButton.isConnected = false
    dom.activeElement = root
    render(false, false, '')
    expect(dom.activeElement).toBe(textarea)
  })

  it('recovers focus when the recovery action disables a focused restore button', () => {
    render(false, false, 'Restore the backup before saving.')
    const restoreButton = new Element('button')
    dialog.append(restoreButton)
    dom.activeElement = restoreButton
    restoreButton.disabled = true
    render(false, true, 'Restore the backup before saving.')
    expect(dom.activeElement).toBe(textarea)
  })

  it('does not intercept Tab if a higher modal has made the note editor inert', () => {
    render()
    backdrop.inert = true
    dom.activeElement = root
    expect(tab()).not.toHaveBeenCalled()
    expect(dom.activeElement).toBe(root)
  })
})
