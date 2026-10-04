import { useEffect, useMemo, useRef, useState } from 'react'
import type { SpeechEvent } from '@shared/types'

export type SpeechPlaying = { key: string; paused: boolean; preparing: boolean } | null
type SpeechActions = {
  speak: (key: string, text: string, playbackRate?: number) => void
  replay: (text: string) => void
  toggle: () => void
  stop: () => void
}

function toWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: string, at: number) => {
    for (let i = 0; i < offset.length; i += 1) view.setUint8(at + i, offset.charCodeAt(i))
  }
  text('RIFF', 0)
  view.setUint32(4, 36 + samples.length * 2, true)
  text('WAVE', 8)
  text('fmt ', 12)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text('data', 36)
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export function useSpeech(onNote: (message: string) => void) {
  const [playing, setPlaying] = useState<SpeechPlaying>(null)
  const actionsRef = useRef<SpeechActions | null>(null)
  const onNoteRef = useRef(onNote)
  onNoteRef.current = onNote

  useEffect(() => {
    const audio = new Audio()
    audio.preservesPitch = true
    let id = ''
    let current: SpeechPlaying = null
    let playbackRate = 1
    let queue: string[] = []
    let active: string | null = null
    let generating = false
    let disposed = false

    function update(next: SpeechPlaying) {
      current = next
      if (!disposed) setPlaying(next)
    }

    function clear() {
      // Invalidate asynchronous audio.play() and worker responses before releasing audio.
      id = ''
      generating = false
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      queue.forEach(URL.revokeObjectURL)
      queue = []
      if (active) URL.revokeObjectURL(active)
      active = null
      update(null)
    }

    function cancelGeneration() {
      void window.api.cancelSpeech().catch(() => undefined)
    }

    function fail(message: string) {
      clear()
      cancelGeneration()
      if (!disposed) onNoteRef.current(message)
    }

    function finishIfEmpty() {
      if (!generating && !queue.length && !active) {
        id = ''
        update(null)
        onNoteRef.current('')
      }
    }

    function startAudio() {
      if (!current || current.paused || !active) return
      const request = id
      const source = active
      update({ ...current, preparing: false })
      onNoteRef.current('')
      void audio.play().catch((cause: unknown) => {
        if (disposed || request !== id || source !== active) return
        // Pausing can abort a pending play() without indicating a playback failure.
        if (current?.paused && cause instanceof Error && cause.name === 'AbortError') return
        fail('playback-failed')
      })
    }

    function playNext() {
      if (!current || current.paused || active) return
      const next = queue.shift()
      if (!next) {
        finishIfEmpty()
        if (current) update({ ...current, preparing: true })
        return
      }
      active = next
      audio.src = next
      audio.playbackRate = playbackRate
      startAudio()
    }

    function toggle() {
      if (!current) return
      const paused = !current.paused
      update({ ...current, paused })
      if (paused) audio.pause()
      else if (active) startAudio()
      else playNext()
    }

    function speak(key: string, text: string, rate = 1) {
      if (!text.trim() || disposed) return
      if (current?.key === key) { toggle(); return }
      clear()
      const request = crypto.randomUUID()
      id = request
      playbackRate = rate
      generating = true
      update({ key, paused: false, preparing: true })
      onNoteRef.current('preparing')
      void window.api.speak(request, text).catch((cause: unknown) => {
        if (disposed || request !== id) return
        fail(cause instanceof Error ? cause.message : 'speech-failed')
      })
    }

    function stop() {
      clear()
      cancelGeneration()
      if (!disposed) onNoteRef.current('')
    }

    actionsRef.current = {
      speak,
      replay: (text) => {
        if (!current) return
        const key = current.key
        clear()
        speak(key, text, playbackRate)
      },
      toggle,
      stop
    }

    function onEnded() {
      // A delayed ended event from a replaced source must not advance the new queue.
      if (!id || !active || !audio.ended) return
      URL.revokeObjectURL(active)
      active = null
      if (current) update({ ...current, preparing: queue.length === 0 && generating })
      if (current?.paused) finishIfEmpty()
      else playNext()
    }
    audio.addEventListener('ended', onEnded)
    const onAudioError = () => { if (id && active && audio.error) fail('playback-failed') }
    audio.addEventListener('error', onAudioError)
    const unsubscribe = window.api.onSpeech((event: SpeechEvent) => {
      if (disposed || !id) return
      if (event.type === 'status') onNoteRef.current(event.message)
      else if (event.id !== id) return
      else if (event.type === 'part') {
        queue.push(URL.createObjectURL(toWav(event.samples, event.sampleRate)))
        if (current?.paused) update({ ...current, preparing: false })
        playNext()
      } else if (event.type === 'done') {
        generating = false
        finishIfEmpty()
      } else if (event.type === 'error') fail(event.message)
    })

    return () => {
      disposed = true
      unsubscribe()
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onAudioError)
      clear()
      cancelGeneration()
      actionsRef.current = null
    }
  }, [])

  const actions = useMemo<SpeechActions>(() => ({
    speak: (...args) => actionsRef.current?.speak(...args),
    replay: (text) => actionsRef.current?.replay(text),
    toggle: () => actionsRef.current?.toggle(),
    stop: () => actionsRef.current?.stop()
  }), [])

  return { playing, ...actions }
}
