import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeechEvent } from '../../shared/types'
import { useSpeech, type SpeechPlaying } from './useSpeech'

// Exercise the hook's audio/event boundary without loading an audio device or TTS model.
const lifecycle = vi.hoisted(() => ({ effects: [] as Array<() => (() => void) | void>, states: [] as unknown[] }))
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, (value: unknown) => lifecycle.states.push(value)],
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => (() => void) | void) => { lifecycle.effects.push(effect) }
}))

class MockAudio {
  src = ''
  paused = true
  ended = false
  error: Error | null = null
  preservesPitch = false
  playbackRate = 1
  playedRates: number[] = []
  listeners = new Map<string, () => void>()
  play = vi.fn(() => {
    this.paused = false
    this.ended = false
    this.playedRates.push(this.playbackRate)
    return Promise.resolve()
  })
  pause = vi.fn(() => { this.paused = true })
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
  load = vi.fn(() => { this.ended = false; this.error = null })
  addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback) }
  removeEventListener(name: string) { this.listeners.delete(name) }
  end() {
    this.paused = true
    this.ended = true
    this.listeners.get('ended')?.()
  }
}

let audio: MockAudio
let emit: (event: SpeechEvent) => void
let cleanups: Array<() => void>
const api = {
  speak: vi.fn<(id: string, text: string) => Promise<void>>(),
  cancelSpeech: vi.fn<() => Promise<void>>(),
  onSpeech: vi.fn()
}

function mount(onNote = vi.fn()) {
  const speech = useSpeech(onNote)
  for (const effect of lifecycle.effects.splice(0)) {
    const cleanup = effect()
    if (cleanup) cleanups.push(cleanup)
  }
  return speech
}

function playing() { return lifecycle.states.at(-1) as SpeechPlaying }

function latestRequest() {
  return api.speak.mock.calls.at(-1)![0]
}

function part(id = latestRequest()) {
  emit({ type: 'part', id, samples: new Float32Array([0, 0.5, 0]), sampleRate: 24000 })
}

beforeEach(() => {
  cleanups = []
  lifecycle.states = []
  vi.clearAllMocks()
  api.speak.mockResolvedValue(undefined)
  api.cancelSpeech.mockResolvedValue(undefined)
  api.onSpeech.mockImplementation((callback: (event: SpeechEvent) => void) => {
    emit = callback
    return vi.fn()
  })
  vi.stubGlobal('window', { api })
  vi.stubGlobal('Audio', class extends MockAudio {
    constructor() { super(); audio = this }
  })
  let nextUrl = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:audio-${++nextUrl}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

describe('speech lifecycle', () => {
  it('keeps a pause requested before the first part and resumes only on explicit action', () => {
    const speech = mount()
    speech.speak('paragraph', 'A paragraph.')
    expect(playing()).toEqual({ key: 'paragraph', paused: false, preparing: true })
    speech.toggle()
    expect(playing()).toEqual({ key: 'paragraph', paused: true, preparing: true })
    part()
    emit({ type: 'done', id: latestRequest() })
    expect(audio.play).not.toHaveBeenCalled()
    expect(playing()).toEqual({ key: 'paragraph', paused: true, preparing: false })
    speech.toggle()
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(playing()).toEqual({ key: 'paragraph', paused: false, preparing: false })
  })

  it('does not play an empty source when pausing and resuming during generation', () => {
    const speech = mount()
    speech.speak('paragraph', 'A paragraph.')
    speech.speak('paragraph', 'A paragraph.')
    speech.speak('paragraph', 'A paragraph.')
    expect(audio.play).not.toHaveBeenCalled()
    expect(playing()?.preparing).toBe(true)
    part()
    expect(audio.play).toHaveBeenCalledTimes(1)
  })

  it('preserves pause intent while waiting for a later generated sentence', () => {
    const speech = mount()
    speech.speak('paragraph', 'A paragraph with several sentences.')
    part()
    audio.end()
    expect(playing()).toEqual({ key: 'paragraph', paused: false, preparing: true })
    speech.toggle()
    part()
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(playing()).toEqual({ key: 'paragraph', paused: true, preparing: false })
    speech.toggle()
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  it('pauses actual audio and discards every queued part after a generation error', () => {
    const note = vi.fn()
    const speech = mount(note)
    speech.speak('paragraph', 'A paragraph.')
    const id = latestRequest()
    part()
    part()
    emit({ type: 'error', id, message: 'Generation failed' })
    expect(audio.paused).toBe(true)
    expect(audio.src).toBe('')
    expect(playing()).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(api.cancelSpeech).toHaveBeenCalledTimes(1)
    expect(note).toHaveBeenLastCalledWith('Generation failed')
    part(id)
    audio.end()
    speech.toggle()
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
  })

  it('cleans up audio and resources on unmount and ignores late worker events', () => {
    const speech = mount()
    speech.speak('paragraph', 'A paragraph.')
    const id = latestRequest()
    part()
    part()
    cleanups.splice(0).forEach((cleanup) => cleanup())
    expect(audio.paused).toBe(true)
    expect(audio.src).toBe('')
    expect(api.cancelSpeech).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    part(id)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    expect(audio.listeners.has('ended')).toBe(false)
  })

  it('reports and resets a rejected audio.play() instead of remaining in a reading state', async () => {
    const note = vi.fn()
    const speech = mount(note)
    audio.play.mockRejectedValueOnce(new Error('No audio device'))
    speech.speak('paragraph', 'A paragraph.')
    part()
    await Promise.resolve()
    expect(playing()).toBeNull()
    expect(audio.paused).toBe(true)
    expect(note).toHaveBeenLastCalledWith('playback-failed')
  })

  it('stops playback when an audio decoding error arrives after playback started', () => {
    const note = vi.fn()
    const speech = mount(note)
    speech.speak('paragraph', 'A paragraph.')
    part()
    part()
    audio.error = new Error('Audio could not be decoded')
    audio.listeners.get('error')?.()
    expect(playing()).toBeNull()
    expect(audio.paused).toBe(true)
    expect(note).toHaveBeenLastCalledWith('playback-failed')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('does not let a rejected play promise from a replaced source stop the new request', async () => {
    let rejectOld: (cause: Error) => void = () => undefined
    const speech = mount()
    audio.play.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOld = reject }))
    speech.speak('old', 'An old paragraph.')
    part()
    speech.speak('new', 'A new paragraph.')
    part()
    rejectOld(new Error('Source replaced'))
    await Promise.resolve()
    expect(playing()).toEqual({ key: 'new', paused: false, preparing: false })
    expect(api.cancelSpeech).not.toHaveBeenCalled()
  })

  it('handles a rejected synthesis request and ignores all later events for it', async () => {
    const note = vi.fn()
    const speech = mount(note)
    api.speak.mockRejectedValueOnce(new Error('Speech worker unavailable'))
    speech.speak('paragraph', 'A paragraph.')
    const id = latestRequest()
    await Promise.resolve()
    expect(playing()).toBeNull()
    expect(note).toHaveBeenLastCalledWith('Speech worker unavailable')
    part(id)
    emit({ type: 'status', message: 'download:25' })
    expect(audio.play).not.toHaveBeenCalled()
    expect(note).toHaveBeenLastCalledWith('Speech worker unavailable')
  })

  it('ignores a stale ended event after loading the first part of a replacement request', () => {
    const speech = mount()
    speech.speak('old', 'An old paragraph.')
    part()
    speech.speak('new', 'A new paragraph.')
    part()
    part()
    audio.listeners.get('ended')?.()
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(playing()?.key).toBe('new')
  })

  it('finishes only after the last generated part is heard', () => {
    const speech = mount()
    speech.speak('paragraph', 'A paragraph.')
    part()
    part()
    emit({ type: 'done', id: latestRequest() })
    audio.end()
    expect(playing()).not.toBeNull()
    audio.end()
    expect(playing()).toBeNull()
  })
})

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('speech playback speed', () => {
  it('keeps slow playback and pitch preservation across every generated part', () => {
    const speech = mount()
    speech.speak('word-slow:ribbon', 'ribbon', 0.75)
    part()
    part()
    expect(audio.playedRates).toEqual([0.75])
    audio.end()
    expect(audio.playedRates).toEqual([0.75, 0.75])
    expect(audio.preservesPitch).toBe(true)
    expect(api.speak).toHaveBeenCalledWith(expect.any(String), 'ribbon')
  })

  it('restores normal speed and ignores old request events when switching keys', () => {
    const speech = mount()
    speech.speak('word-slow:ribbon', 'ribbon', 0.75)
    const oldId = latestRequest()
    part()
    part()
    speech.speak('sentence:ribbon', 'A ribbon holds its shape.')
    const currentId = latestRequest()
    expect(currentId).not.toBe(oldId)
    const pauses = audio.pause.mock.calls.length
    part(oldId)
    emit({ type: 'done', id: oldId })
    emit({ type: 'error', id: oldId, message: 'Old request failed' })
    expect(audio.pause).toHaveBeenCalledTimes(pauses)
    part(currentId)
    expect(audio.playedRates).toEqual([0.75, 1])
    expect(api.cancelSpeech).not.toHaveBeenCalled()
  })

  it('retains same-key pause and resume without synthesizing another request', () => {
    const speech = mount()
    speech.speak('word-slow:ribbon', 'ribbon', 0.75)
    part()
    speech.speak('word-slow:ribbon', 'ribbon', 0.75)
    expect(audio.paused).toBe(true)
    speech.speak('word-slow:ribbon', 'ribbon', 0.75)
    expect(audio.paused).toBe(false)
    expect(audio.playedRates).toEqual([0.75, 0.75])
    expect(api.speak).toHaveBeenCalledTimes(1)
  })

  it('retains the current playback rate when replaying', () => {
    const speech = mount()
    speech.speak('word-slow:ribbon', 'ribbon', 0.75)
    part()
    speech.replay('ribbon')
    part()
    expect(audio.playedRates).toEqual([0.75, 0.75])
    expect(api.speak).toHaveBeenCalledTimes(2)
  })

  it('ignores stopped audio parts and starts the next normal request at normal speed', () => {
    const speech = mount()
    speech.speak('word-slow:ribbon', 'ribbon', 0.75)
    const oldId = latestRequest()
    part()
    speech.stop()
    part(oldId)
    expect(audio.playedRates).toEqual([0.75])
    expect(api.cancelSpeech).toHaveBeenCalledTimes(1)
    speech.speak('word:ribbon', 'ribbon')
    part()
    expect(audio.playedRates).toEqual([0.75, 1])
  })
})
