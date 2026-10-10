import { KokoroRuntime } from './kokoro-runtime'
import { readSpeechCache, writeSpeechCache } from './speech-cache'
import type { VoiceId } from '../shared/types'

type Incoming =
  | { type: 'init'; cacheDir: string; modelDir: string; voiceDirectory: string }
  | { type: 'cancel' }
  | { type: 'speak'; id: string; text: string; voice: string; speed: number }

const SAMPLE_RATE = 24000

const port = process.parentPort
let cacheDir = ''
let modelDir = ''
let voiceDirectory = ''
let current = ''
let loading: Promise<KokoroRuntime> | null = null
let queue: Promise<void> = Promise.resolve()

port.on('message', (event) => {
  const message = event.data as Incoming
  if (message.type === 'init') {
    cacheDir = message.cacheDir
    modelDir = message.modelDir
    voiceDirectory = message.voiceDirectory
  } else if (message.type === 'cancel') {
    current = ''
    port.postMessage({ type: 'status', message: '' })
  } else if (message.type === 'speak') {
    current = message.id
    queue = queue.then(() => run(message))
  }
})

async function run(request: Extract<Incoming, { type: 'speak' }>) {
  const { id, voice, speed } = request
  try {
    const pending = splitSentences(request.text)
    while (pending.length > 0) {
      const sentence = pending.shift()!
      if (current !== id) return
      let samples: Float32Array | null = await readSpeechCache(cacheDir, voice, speed, sentence)
      if (!samples) {
        const tts = await model()
        if (current !== id) return
        let audio: Awaited<ReturnType<KokoroRuntime['generate']>>
        try {
          audio = await tts.generate(sentence, { voice: voice as VoiceId, speed })
        } catch (error) {
          if (error instanceof Error && error.message === 'speech-text-too-long' && Array.from(sentence).length > 1) {
            pending.unshift(...boundSpeechChunks(sentence, Math.ceil(Array.from(sentence).length / 2)))
            continue
          }
          throw error
        }
        const generated: Float32Array = audio.audio
        await writeSpeechCache(cacheDir, voice, speed, sentence, generated)
        samples = generated
      }
      if (current !== id) return
      port.postMessage({ type: 'part', id, samples, sampleRate: SAMPLE_RATE })
    }
    if (current === id) port.postMessage({ type: 'done', id })
  } catch (error) {
    if (current === id) port.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : 'speech-failed' })
  }
}

function model() {
  if (!loading) {
    port.postMessage({ type: 'status', message: 'prepare' })
    loading = KokoroRuntime.create({
      cacheDir: modelDir,
      voiceDirectory,
      progress_callback: (info) => {
        if (current && info.status === 'progress' && info.progress < 100) {
          port.postMessage({ type: 'status', message: `download:${Math.round(info.progress)}` })
        }
      }
    })
      .then((tts) => {
        port.postMessage({ type: 'status', message: '' })
        return tts
      })
      .catch((error: unknown) => {
        loading = null
        port.postMessage({ type: 'status', message: '' })
        throw error
      })
  }
  return loading
}

export function splitSentences(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/)
  const merged: string[] = []
  for (const sentence of sentences) {
    const last = merged[merged.length - 1]
    if (last && last.length < 24) merged[merged.length - 1] = `${last} ${sentence}`
    else merged.push(sentence)
  }
  return merged.flatMap((sentence) => boundSpeechChunks(sentence))
}

/** Bound every unit, including prose with no punctuation and unusually long words.
 * Normalized whitespace may become a pause; every content codepoint is retained. */
export function boundSpeechChunks(text: string, limit = 240): string[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('speech-chunk-size-invalid')
  const characters = Array.from(text.trim())
  const chunks: string[] = []
  let offset = 0
  while (offset < characters.length) {
    let end = Math.min(offset + limit, characters.length)
    if (end < characters.length) {
      for (let index = end; index > offset; index -= 1) {
        if (/\s/.test(characters[index])) { end = index; break }
      }
    }
    const chunk = characters.slice(offset, end).join('').trim()
    if (chunk) chunks.push(chunk)
    offset = end
    while (offset < characters.length && /\s/.test(characters[offset])) offset += 1
  }
  return chunks
}
