import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'

export const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
export const KOKORO_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231'
export const KOKORO_MODEL_FILE = {
  file: 'onnx/model_quantized.onnx',
  bytes: 92_361_116,
  sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'
} as const

export type ModelProgress = { status: 'progress'; progress: number }

type PinnedModelFile = { file: string; bytes: number; sha256: string }
type CacheOptions = { allowRemoteModels?: boolean; progress_callback?: (progress: ModelProgress) => void }

async function matchesModel(path: string, expected: PinnedModelFile) {
  const stat = await fs.lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!stat) return false
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('speech-model-cache-file-invalid')
  if (stat.size !== expected.bytes) return false
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex') === expected.sha256
}

async function validateCacheDirectories(cacheDir: string, create: boolean) {
  for (const [index, directory] of [cacheDir, join(cacheDir, 'onnx-community'), join(cacheDir, KOKORO_MODEL), join(cacheDir, KOKORO_MODEL, 'onnx')].entries()) {
    let stat = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!stat) {
      if (!create) return false
      // Descendants are created one level at a time, after the previous parent was checked.
      await fs.mkdir(directory, { recursive: index === 0 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
      stat = await fs.lstat(directory)
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('speech-model-cache-directory-invalid')
  }
  return true
}

export async function preparePinnedKokoroFile(cacheDir: string, expected: PinnedModelFile, options: CacheOptions = {}) {
  if (expected.file !== KOKORO_MODEL_FILE.file || !Number.isSafeInteger(expected.bytes) || expected.bytes <= 0 || !/^[a-f0-9]{64}$/.test(expected.sha256)) {
    throw new Error('speech-model-definition-invalid')
  }
  // Preserve the existing Transformers cache location; valid existing models are reused.
  const destination = join(cacheDir, ...KOKORO_MODEL.split('/'), ...expected.file.split('/'))
  if (await validateCacheDirectories(cacheDir, false) && await matchesModel(destination, expected)) return destination
  if (options.allowRemoteModels === false) throw new Error('speech-model-not-cached')

  await validateCacheDirectories(cacheDir, true)
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  const handle = await fs.open(temporary, 'wx', 0o600)
  let completed = false
  try {
    const url = `https://huggingface.co/${KOKORO_MODEL}/resolve/${KOKORO_REVISION}/${expected.file}`
    const response = await fetch(url, { signal: AbortSignal.timeout(240_000) })
    if (!response.ok || !response.body) throw new Error('speech-model-download-failed')
    const advertised = response.headers.get('content-length')
    if (advertised && Number(advertised) !== expected.bytes) throw new Error('speech-model-download-size-invalid')
    const hash = createHash('sha256')
    let bytes = 0
    options.progress_callback?.({ status: 'progress', progress: 0 })
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > expected.bytes) throw new Error('speech-model-download-size-invalid')
      hash.update(chunk)
      await handle.writeFile(chunk)
      options.progress_callback?.({ status: 'progress', progress: Math.min(99, Math.floor(bytes / expected.bytes * 100)) })
    }
    if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) {
      throw new Error('speech-model-download-integrity-invalid')
    }
    await handle.sync()
    await handle.close()
    await fs.rename(temporary, destination)
    completed = true
    options.progress_callback?.({ status: 'progress', progress: 100 })
    return destination
  } finally {
    if (!completed) {
      await handle.close().catch(() => {})
      await fs.rm(temporary, { force: true })
    }
  }
}

export async function prepareKokoroModel(cacheDir: string, options: CacheOptions = {}) {
  return preparePinnedKokoroFile(cacheDir, KOKORO_MODEL_FILE, options)
}
