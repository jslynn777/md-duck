import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { env } from '@huggingface/transformers'
import { KokoroTTS, type GenerateOptions } from 'kokoro-js'

type Incoming =
  | { type: 'init'; cacheDir: string; modelDir: string }
  | { type: 'cancel' }
  | { type: 'speak'; id: string; text: string; voice: string; speed: number }

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const SAMPLE_RATE = 24000

const port = process.parentPort
let cacheDir = ''
let current = ''
let loading: Promise<KokoroTTS> | null = null
let queue: Promise<void> = Promise.resolve()

port.on('message', (event) => {
  const message = event.data as Incoming
  if (message.type === 'init') {
    cacheDir = message.cacheDir
    env.cacheDir = message.modelDir
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
    for (const sentence of splitSentences(request.text)) {
      if (current !== id) return
      let samples: Float32Array | null = await readCache(voice, speed, sentence)
      if (!samples) {
        const tts = await model()
        if (current !== id) return
        const audio = await tts.generate(sentence, { voice: voice as GenerateOptions['voice'], speed })
        const generated: Float32Array = audio.audio
        await writeCache(voice, speed, sentence, generated)
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
    loading = KokoroTTS.from_pretrained(MODEL, {
      dtype: 'q8',
      device: 'cpu',
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
  return merged.flatMap((sentence) => (sentence.length > 360 ? sentence.split(/(?<=[,;:])\s+/) : [sentence]))
}

function cacheFile(voice: string, speed: number, sentence: string) {
  const hash = createHash('sha256').update(`${voice}\n${speed}\n${sentence}`).digest('hex')
  return join(cacheDir, `${hash}.f32`)
}

async function readCache(voice: string, speed: number, sentence: string) {
  if (!cacheDir) return null
  const data = await fs.readFile(cacheFile(voice, speed, sentence)).catch(() => null)
  if (!data) return null
  return new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}

async function writeCache(voice: string, speed: number, sentence: string, samples: Float32Array) {
  if (!cacheDir) return
  await fs.mkdir(cacheDir, { recursive: true })
  const file = cacheFile(voice, speed, sentence)
  const temp = `${file}.${process.pid}.tmp`
  await fs.writeFile(temp, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
  await fs.rename(temp, file)
}
