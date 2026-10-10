import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KOKORO_MODEL, KOKORO_REVISION, preparePinnedKokoroFile } from './kokoro-runtime-cache'

let directory: string
let destination: string
const bytes = Buffer.from('verified model fixture')
const expected = { file: 'onnx/model_quantized.onnx', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
const remote = vi.fn()
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'md-duck-model-cache-'))
  destination = join(directory, KOKORO_MODEL, expected.file)
  remote.mockReset()
  vi.stubGlobal('fetch', remote)
})
afterEach(async () => { vi.unstubAllGlobals(); await fs.rm(directory, { recursive: true, force: true }) })

describe('pinned neural model cache', () => {
  it('reuses a valid cached file offline without a request or modification', async () => {
    await fs.mkdir(join(directory, KOKORO_MODEL, 'onnx'), { recursive: true })
    await fs.writeFile(destination, bytes)
    const before = await fs.stat(destination)
    expect(await preparePinnedKokoroFile(directory, expected, { allowRemoteModels: false })).toBe(destination)
    expect(remote).not.toHaveBeenCalled()
    expect((await fs.stat(destination)).mtimeMs).toBe(before.mtimeMs)
  })
  it('never creates files or downloads when an offline model is absent', async () => {
    await expect(preparePinnedKokoroFile(directory, expected, { allowRemoteModels: false })).rejects.toThrow('speech-model-not-cached')
    expect(remote).not.toHaveBeenCalled()
    expect(await fs.readdir(directory)).toEqual([])
  })
  it('downloads a fixed revision, verifies bytes, and publishes progress only after completion', async () => {
    remote.mockResolvedValue(new Response(bytes))
    const progress: number[] = []
    await preparePinnedKokoroFile(directory, expected, { progress_callback: (event) => progress.push(event.progress) })
    expect(remote.mock.calls[0][0]).toContain(`/resolve/${KOKORO_REVISION}/`)
    expect(await fs.readFile(destination)).toEqual(bytes)
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(100)
    expect(await fs.readdir(join(directory, KOKORO_MODEL, 'onnx'))).toEqual(['model_quantized.onnx'])
  })
  for (const [name, body] of [
    ['incomplete', bytes.subarray(1)],
    ['oversized', Buffer.concat([bytes, Buffer.from('!')])],
    ['wrong hash', Buffer.alloc(bytes.length, 10)]
  ] as const) {
    it(`retains the old cache and cleans temporary files after an ${name} response`, async () => {
      await fs.mkdir(join(directory, KOKORO_MODEL, 'onnx'), { recursive: true })
      const previous = Buffer.from('previous cache data')
      await fs.writeFile(destination, previous)
      remote.mockResolvedValue(new Response(body))
      await expect(preparePinnedKokoroFile(directory, expected)).rejects.toThrow(/speech-model-download-(size|integrity)-invalid/)
      expect(await fs.readFile(destination)).toEqual(previous)
      expect(await fs.readdir(join(directory, KOKORO_MODEL, 'onnx'))).toEqual(['model_quantized.onnx'])
    })
  }
  it('cleans up a failed network request', async () => {
    remote.mockRejectedValue(new Error('Network unavailable'))
    await expect(preparePinnedKokoroFile(directory, expected)).rejects.toThrow('Network unavailable')
    expect(await fs.readdir(join(directory, KOKORO_MODEL, 'onnx'))).toEqual([])
  })
  it('refuses a symlinked cache parent before creating descendants', async () => {
    const external = await fs.mkdtemp(join(tmpdir(), 'md-duck-external-model-'))
    try {
      await fs.symlink(external, join(directory, 'onnx-community'), 'dir')
      await expect(preparePinnedKokoroFile(directory, expected)).rejects.toThrow('speech-model-cache-directory-invalid')
      expect(remote).not.toHaveBeenCalled()
      expect(await fs.readdir(external)).toEqual([])
    } finally { await fs.rm(external, { recursive: true, force: true }) }
  })
})
