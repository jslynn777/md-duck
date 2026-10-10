import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import { VOICES, type VoiceId } from '../shared/types'
import { prepareKokoroModel, type ModelProgress } from './kokoro-runtime-cache'
import { phonemize } from './kokoro-runtime-phonemize.js'
import { encodeKokoroPhonemes, kokoroStyleOffset, KOKORO_REMOVE } from './kokoro-runtime-tokenizer'

type RuntimeOptions = {
  cacheDir: string
  voiceDirectory: string
  allowRemoteModels?: boolean
  progress_callback?: (progress: ModelProgress) => void
}

export { phonemize as phonemizeKokoroText } from './kokoro-runtime-phonemize.js'

/** The same Kokoro q8 model and voice styles, through the native CPU ONNX runtime. */
export class KokoroRuntime {
  private readonly voices = new Map<VoiceId, Float32Array>()

  private constructor(private readonly session: InferenceSession, private readonly voiceDirectory: string) {}

  static async create(options: RuntimeOptions) {
    const path = await prepareKokoroModel(options.cacheDir, options)
    const session = await InferenceSession.create(path, { executionProviders: ['cpu'] })
    return new KokoroRuntime(session, options.voiceDirectory)
  }

  async generate(text: string, options: { voice: VoiceId; speed: number }) {
    if (!VOICES.includes(options.voice)) throw new Error('speech-voice-invalid')
    if (!Number.isFinite(options.speed) || options.speed <= 0) throw new Error('speech-speed-invalid')
    const phonemes = await phonemize(text, options.voice.startsWith('b') ? 'b' : 'a')
    if (Array.from(phonemes.replace(KOKORO_REMOVE, '')).length > 510) throw new Error('speech-text-too-long')
    return this.generateFromIds(encodeKokoroPhonemes(phonemes), options)
  }

  async generateFromIds(ids: number[], options: { voice: VoiceId; speed: number }) {
    if (!VOICES.includes(options.voice)) throw new Error('speech-voice-invalid')
    if (!Number.isFinite(options.speed) || options.speed <= 0) throw new Error('speech-speed-invalid')
    if (ids.length < 2 || ids.length > 512 || ids.some((id) => !Number.isInteger(id) || id < 0 || id > 177)) {
      throw new Error('speech-tokens-invalid')
    }
    const styleData = await this.voice(options.voice)
    const offset = kokoroStyleOffset(ids.length)
    const result = await this.session.run({
      input_ids: new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      style: new Tensor('float32', styleData.slice(offset, offset + 256), [1, 256]),
      speed: new Tensor('float32', Float32Array.of(options.speed), [1])
    })
    const audio = result.waveform?.data
    if (!(audio instanceof Float32Array) || audio.length === 0 || audio.some((sample) => !Number.isFinite(sample))) {
      throw new Error('speech-audio-invalid')
    }
    return { audio, sampling_rate: 24_000 }
  }

  private async voice(id: VoiceId) {
    const cached = this.voices.get(id)
    if (cached) return cached
    const bytes = await fs.readFile(join(this.voiceDirectory, `${id}.bin`))
    if (bytes.byteLength !== 510 * 256 * 4) throw new Error('speech-voice-data-invalid')
    const style = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    this.voices.set(id, style)
    return style
  }

  async dispose() {
    this.voices.clear()
    await this.session.release()
  }
}
