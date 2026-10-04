import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ env: { cacheDir: '' }, fromPretrained: vi.fn() }))
vi.mock('@huggingface/transformers', () => ({ env: mocked.env }))
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: mocked.fromPretrained } }))

let listener: (event: { data: unknown }) => void
let messages: Array<Record<string, any>>
let previousPort: unknown
beforeEach(async () => {
  vi.resetModules()
  mocked.fromPretrained.mockReset()
  messages = []
  previousPort = (process as any).parentPort
  ;(process as any).parentPort = {
    on: (_event: string, handler: typeof listener) => { listener = handler },
    postMessage: (message: Record<string, any>) => messages.push(message)
  }
  await import('./speech-worker')
  listener({ data: { type: 'init', cacheDir: '', modelDir: '/test/model-cache' } })
})
afterEach(() => { (process as any).parentPort = previousPort })

const speak = (id: string) => listener({ data: { type: 'speak', id, text: 'Hello world.', voice: 'af_heart', speed: 1 } })
const tts = () => ({ generate: vi.fn(async () => ({ audio: Float32Array.of(0, 0.1, 0) })) })

describe('speech model preparation', () => {
  it('never downloads on initialization and begins preparing only after an explicit speak request', async () => {
    await Promise.resolve()
    expect(mocked.env.cacheDir).toBe('/test/model-cache')
    expect(mocked.fromPretrained).not.toHaveBeenCalled()
    expect(messages).toEqual([])
    mocked.fromPretrained.mockResolvedValueOnce(tts())
    speak('first')
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'done', id: 'first' }))
    expect(mocked.fromPretrained).toHaveBeenCalledOnce()
    expect(messages[0]).toEqual({ type: 'status', message: 'prepare' })
    expect(messages).toContainEqual({ type: 'status', message: '' })
  })
  it('clears a failed download status and retries preparation on the next request', async () => {
    mocked.fromPretrained.mockImplementationOnce((_model, options) => {
      options.progress_callback({ status: 'progress', progress: 30 })
      return Promise.reject(new Error('Network unavailable'))
    })
    speak('failed')
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'error', id: 'failed', message: 'Network unavailable' }))
    expect(messages).toContainEqual({ type: 'status', message: 'download:30' })
    const errorIndex = messages.findIndex((event) => event.type === 'error')
    expect(messages[errorIndex - 1]).toEqual({ type: 'status', message: '' })
    mocked.fromPretrained.mockResolvedValueOnce(tts())
    speak('retry')
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'done', id: 'retry' }))
    expect(mocked.fromPretrained).toHaveBeenCalledTimes(2)
  })
  it('clears progress on cancel and never speaks a canceled request when preparation completes', async () => {
    let finish!: (value: ReturnType<typeof tts>) => void
    let progress!: (value: unknown) => void
    mocked.fromPretrained.mockImplementationOnce((_model, options) => {
      progress = options.progress_callback
      return new Promise((resolve) => { finish = resolve })
    })
    speak('canceled')
    await vi.waitFor(() => expect(mocked.fromPretrained).toHaveBeenCalledOnce())
    listener({ data: { type: 'cancel' } })
    progress({ status: 'progress', progress: 80 })
    expect(messages.at(-1)).toEqual({ type: 'status', message: '' })
    const loaded = tts()
    finish(loaded)
    speak('next')
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'done', id: 'next' }))
    expect(messages.some((event) => event.id === 'canceled' && ['part', 'done', 'error'].includes(event.type))).toBe(false)
    expect(loaded.generate).toHaveBeenCalledOnce()
    expect(mocked.fromPretrained).toHaveBeenCalledOnce()
  })
})
