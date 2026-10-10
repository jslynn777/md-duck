import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { AI_PRESETS } from '../shared/ai'
import { createAIService, normalizeAIBaseUrl, requestChat, type AICredentials } from './ai-service'

const paths: string[] = []
const disposers: (() => void)[] = []
const reply = (text = 'OK') => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }))
const encrypt = (key: string) => Buffer.from(`encrypted-test-fixture:${key}`).toString('base64')
const decrypt = (key: string) => Buffer.from(key, 'base64').toString().replace('encrypted-test-fixture:', '')
const config = (provider: 'openrouter' | 'deepseek' = 'openrouter', key?: string | null) => ({ provider, ...AI_PRESETS[provider], ...(key !== undefined ? { key } : {}) })
const credentials: AICredentials = { provider: 'openrouter', baseUrl: AI_PRESETS.openrouter.baseUrl, model: 'test/model', key: 'test-secret' }
const messages = [{ role: 'user' as const, content: 'Test only.' }]

async function fixture(extra: Partial<Parameters<typeof createAIService>[0]> = {}) {
  const path = await mkdtemp(join(tmpdir(), 'md-duck-ai-'))
  paths.push(path)
  const options = { storePath: join(path, 'ai.json'), encrypt, decrypt, openExternal: async () => {}, ...extra }
  const service = createAIService(options)
  disposers.push(service.dispose)
  await service.init()
  return { service, options }
}
afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('provider requests', () => {
  it('sends a real compatible HTTP request to the configured local service', async () => {
    let received: { authorization?: string; url?: string; body?: unknown } = {}
    const server = createServer(async (req, res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      received = { authorization: req.headers.authorization, url: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: 'A real local response.' } }] }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('missing fixture address')
      const output = await requestChat({ ...credentials, provider: 'custom', baseUrl: `http://127.0.0.1:${address.port}/v1/` }, messages, { maxTokens: 32 })
      expect(output).toBe('A real local response.')
      expect(received).toMatchObject({ authorization: 'Bearer test-secret', url: '/v1/chat/completions', body: { model: 'test/model', max_tokens: 32, stream: false, messages } })
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it.each([[401, 'ERR_BAD_KEY'], [403, 'ERR_BAD_KEY'], [402, 'ERR_NO_CREDIT'], [429, 'ERR_RATE_LIMIT'], [404, 'ERR_MODEL'], [400, 'ERR_MODEL'], [504, 'ERR_TIMEOUT'], [503, 'ERR_STATUS:503']])('maps HTTP %s without returning provider error text', async (status, code) => {
    await expect(requestChat(credentials, messages, { fetcher: async () => new Response('secret provider diagnostic', { status: Number(status) }) })).rejects.toThrow(String(code))
  })

  it('turns cancellation, timeout, malformed and truncated responses into distinct safe errors', async () => {
    const controller = new AbortController()
    const pending = requestChat(credentials, messages, { signal: controller.signal, fetcher: async (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('raw transport diagnostic')))) })
    controller.abort()
    await expect(pending).rejects.toThrow('ERR_CANCELLED')
    await expect(requestChat(credentials, messages, { timeoutMs: 10, fetcher: async (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('timeout')))) })).rejects.toThrow('ERR_TIMEOUT')
    await expect(requestChat(credentials, messages, { fetcher: async () => new Response('not json') })).rejects.toThrow('ERR_BAD_RESPONSE')
    await expect(requestChat(credentials, messages, { fetcher: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'Incomplete' } }] })) })).rejects.toThrow('ERR_TRUNCATED')
    await expect(requestChat(credentials, messages, { fetcher: async () => reply('') })).rejects.toThrow('ERR_NO_TEXT')
  })

  it('does not follow redirects with credentials, and disables DeepSeek reasoning for reading requests', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => reply())
    await requestChat({ ...credentials, provider: 'deepseek', baseUrl: AI_PRESETS.deepseek.baseUrl }, messages, { fetcher })
    const init = fetcher.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.redirect).toBe('error')
    expect(JSON.parse(String(init?.body)).thinking).toEqual({ type: 'disabled' })
    expect(init?.headers).not.toHaveProperty('HTTP-Referer')
  })

  it.each(['http://api.example.com', 'file:///tmp/key', 'https://user:secret@example.com', 'https://example.com?key=secret', 'https://example.com/#hash'])('rejects unsafe custom base URL %s', (url) => {
    expect(() => normalizeAIBaseUrl(url)).toThrow('ERR_CONFIG')
  })
})

describe('AI profile storage and connection state', () => {
  it('keeps each provider profile separate and never exposes its key to UI or plaintext disk', async () => {
    const { service, options } = await fixture({ fetcher: async () => reply() })
    expect(service.state().profiles.openrouter.status).toBe('unconfigured')
    await service.save(config('openrouter', 'router-test-secret'))
    expect(service.state().profiles.openrouter.status).toBe('untested')
    await service.test()
    expect(service.state().profiles.openrouter.status).toBe('connected')
    await service.save(config('deepseek', 'deepseek-test-secret'))
    expect(service.credentials().key).toBe('deepseek-test-secret')
    expect(service.state().profiles.openrouter.hasKey).toBe(true)
    await service.save(config('openrouter'))
    expect(service.credentials().key).toBe('router-test-secret')
    const disk = await readFile(options.storePath, 'utf8')
    expect(disk).not.toContain('router-test-secret')
    expect(disk).not.toContain('deepseek-test-secret')
    expect(JSON.stringify(service.state())).not.toMatch(/test-secret|encryptedKey/)
    // Windows uses ACLs and does not report POSIX owner/group permission bits.
    // The key encryption and UI/disk non-disclosure assertions run everywhere.
    if (process.platform !== 'win32') expect((await stat(options.storePath)).mode & 0o777).toBe(0o600)
    const reloaded = createAIService(options)
    disposers.push(reloaded.dispose)
    await reloaded.init()
    expect(reloaded.credentials().key).toBe('router-test-secret')
    expect(reloaded.state().profiles.openrouter.status).toBe('untested')
    await reloaded.save(config('openrouter', null))
    expect(reloaded.state().profiles.openrouter).toMatchObject({ hasKey: false, status: 'unconfigured' })
    expect(reloaded.credentials().key).toBe('')
  })

  it('migrates an existing OpenRouter key and model once without making requests', async () => {
    const fetcher = vi.fn(async () => reply())
    const { service, options } = await fixture({ legacy: { key: 'legacy-test-secret', model: 'legacy/model' }, fetcher })
    expect(service.credentials()).toMatchObject({ key: 'legacy-test-secret', model: 'legacy/model' })
    expect(fetcher).not.toHaveBeenCalled()
    await service.save(config('openrouter', null))
    const reloaded = createAIService(options)
    disposers.push(reloaded.dispose)
    await reloaded.init()
    expect(reloaded.credentials().key).toBe('')
  })

  it('marks test failures visibly while preserving the saved profile for repair', async () => {
    const { service } = await fixture({ fetcher: async () => new Response('private message', { status: 402 }) })
    await service.save(config('openrouter', 'test-secret'))
    expect((await service.test()).profiles.openrouter).toMatchObject({ hasKey: true, status: 'error', error: 'ERR_NO_CREDIT' })
    expect(service.credentials().key).toBe('test-secret')
  })

  it('discards an old test result after another provider or key is saved', async () => {
    let finish!: (response: Response) => void
    const { service } = await fixture({ fetcher: async () => new Promise((resolve) => { finish = resolve }) })
    await service.save(config('openrouter', 'first-test-secret'))
    const pending = service.test()
    await service.save(config('deepseek', 'second-test-secret'))
    finish(reply())
    await pending
    expect(service.state().provider).toBe('deepseek')
    expect(service.state().profiles.openrouter.status).toBe('untested')
    expect(service.state().profiles.deepseek.status).toBe('untested')
  })

  it('serializes concurrent saves so the durable result matches the latest selected profile', async () => {
    const { service, options } = await fixture()
    await Promise.all([service.save(config('openrouter', 'first-test-secret')), service.save(config('deepseek', 'second-test-secret'))])
    expect(JSON.parse(await readFile(options.storePath, 'utf8')).provider).toBe('deepseek')
    expect(service.state().provider).toBe('deepseek')
  })

  it('does not accept plaintext encryption fallback or send a preset key to an edited endpoint', async () => {
    const { service } = await fixture({ encrypt: (key) => key })
    await expect(service.save(config('openrouter', 'test-secret'))).rejects.toThrow('ERR_STORAGE')
    await expect(service.save({ ...config('deepseek', 'test-secret'), baseUrl: 'https://other.example.com' })).rejects.toThrow('ERR_CONFIG')
    expect(service.state().profiles.openrouter.hasKey).toBe(false)
  })

  it('does not overwrite a corrupt settings file with a legacy configuration', async () => {
    const { service, options } = await fixture()
    service.dispose()
    await writeFile(options.storePath, 'broken-fixture')
    const reloaded = createAIService({ ...options, legacy: { key: 'legacy-test-secret', model: 'old-model' } })
    disposers.push(reloaded.dispose)
    await expect(reloaded.init()).rejects.toThrow('ERR_STORAGE')
    expect(reloaded.state().profiles.openrouter).toMatchObject({ hasKey: false, status: 'error', error: 'ERR_STORAGE' })
    expect(() => reloaded.credentials()).toThrow('ERR_STORAGE')
    await expect(reloaded.save(config('openrouter', 'new-fixture-secret'))).rejects.toThrow('ERR_STORAGE')
    expect(await readFile(options.storePath, 'utf8')).toBe('broken-fixture')
  })

  it('preserves unreadable encrypted credentials until explicitly removed', async () => {
    const { service, options } = await fixture()
    await service.save(config('openrouter', 'fixture-secret'))
    const stored = JSON.parse(await readFile(options.storePath, 'utf8')).profiles.openrouter.encryptedKey
    const reloaded = createAIService({ ...options, decrypt: () => null })
    disposers.push(reloaded.dispose)
    await reloaded.init()
    expect(reloaded.state().profiles.openrouter).toMatchObject({ hasKey: false, status: 'error', error: 'ERR_STORAGE' })
    await reloaded.save(config('deepseek', 'different-secret'))
    expect(JSON.parse(await readFile(options.storePath, 'utf8')).profiles.openrouter.encryptedKey).toBe(stored)
    await reloaded.save(config('openrouter', null))
    expect(JSON.parse(await readFile(options.storePath, 'utf8')).profiles.openrouter.encryptedKey).toBeUndefined()
  })

  it('completes browser authorization, securely saves its key and performs a minimal connection test', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('/auth/keys')
      ? new Response(JSON.stringify({ key: 'fixture-oauth-secret' })) : reply())
    const { service } = await fixture({ fetcher, openExternal: async (url) => {
      const callback = new URL(new URL(url).searchParams.get('callback_url')!)
      callback.searchParams.set('code', 'fixture-code')
      await fetch(callback)
    } })
    const state = await service.connectOpenRouter()
    expect(state.profiles.openrouter).toMatchObject({ status: 'connected', hasKey: true })
    expect(service.credentials().key).toBe('fixture-oauth-secret')
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://openrouter.ai/api/v1/auth/keys', 'https://openrouter.ai/api/v1/chat/completions'])
    expect(JSON.stringify(state)).not.toContain('fixture-oauth-secret')
  })

  it('does not let an old authorization overwrite a newly selected service', async () => {
    let callback: URL | undefined
    let opened!: () => void
    const ready = new Promise<void>((resolve) => { opened = resolve })
    const { service } = await fixture({ openExternal: async (url) => { callback = new URL(new URL(url).searchParams.get('callback_url')!); opened() } })
    const auth = service.connectOpenRouter()
    const rejection = expect(auth).rejects.toThrow('ERR_CANCELLED')
    await ready
    await service.save(config('deepseek', 'new-test-secret'))
    await rejection
    expect(callback?.hostname).toBe('127.0.0.1')
    expect(service.state().provider).toBe('deepseek')
    expect(service.state().profiles.openrouter.hasKey).toBe(false)
  })
})
