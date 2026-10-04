import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { AI_PRESETS, type AIConfigInput, type AIMessage, type AIProfile, type AIProvider, type AISettings } from '../shared/ai'
import { authorizeOpenRouter, type Fetcher } from './ai-oauth'

export type AICredentials = { provider: AIProvider; baseUrl: string; model: string; key: string }
type RequestOptions = { signal?: AbortSignal; temperature?: number; maxTokens?: number; timeoutMs?: number; fetcher?: Fetcher }
type Options = {
  storePath: string
  encrypt: (key: string) => string
  decrypt: (encrypted: string) => string | null
  legacy?: { key: string | null; model: string }
  openExternal: (url: string) => void | Promise<void>
  onChange?: (state: AISettings) => void
  fetcher?: Fetcher
  authTimeoutMs?: number
  requestTimeoutMs?: number
}
type PrivateProfile = AIProfile & { key: string; encryptedKey?: string }
const providers: AIProvider[] = ['openrouter', 'deepseek', 'custom']
const controlCharacters = /[\u0000-\u001f\u007f]/
const knownErrors = /^(?:NO_KEY|ERR_(?:BAD_KEY|NO_CREDIT|MODEL|RATE_LIMIT|TIMEOUT|CANCELLED|NETWORK|BAD_RESPONSE|NO_TEXT|TRUNCATED|CONFIG|STORAGE|AUTH|AUTH_TIMEOUT|STATUS:\d{3}))$/

export function aiErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return knownErrors.test(message) ? message : 'ERR_NETWORK'
}

export function normalizeAIBaseUrl(value: string): string {
  if (typeof value !== 'string' || value.length > 2048 || controlCharacters.test(value)) throw new Error('ERR_CONFIG')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('ERR_CONFIG') }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('ERR_CONFIG')
  if (url.username || url.password || url.search || url.hash) throw new Error('ERR_CONFIG')
  return url.href.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}

function validateKey(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192 || /\s/.test(value.trim()) || controlCharacters.test(value)) throw new Error('ERR_CONFIG')
  return value.trim()
}
function validateModel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 240 || controlCharacters.test(value)) throw new Error('ERR_CONFIG')
  return value.trim()
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }

async function limitedJSON(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('ERR_BAD_RESPONSE')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('ERR_BAD_RESPONSE')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 2_000_000) { await reader.cancel(); throw new Error('ERR_BAD_RESPONSE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('ERR_BAD_RESPONSE') }
}

export async function requestChat(credentials: AICredentials, messages: AIMessage[], options: RequestOptions = {}): Promise<string> {
  if (!credentials.key) throw new Error('NO_KEY')
  validateKey(credentials.key)
  const baseUrl = normalizeAIBaseUrl(credentials.baseUrl)
  const model = validateModel(credentials.model)
  if (!providers.includes(credentials.provider) || !Array.isArray(messages) || !messages.length || messages.some((message) => !['user', 'assistant', 'system'].includes(message.role) || typeof message.content !== 'string')) throw new Error('ERR_CONFIG')
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 60000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  if (signal.aborted) throw new Error('ERR_CANCELLED')
  try {
    const response = await (options.fetcher ?? fetch)(`${baseUrl}/chat/completions`, {
      method: 'POST', redirect: 'error', signal,
      headers: {
        Authorization: `Bearer ${credentials.key}`, 'Content-Type': 'application/json',
        ...(credentials.provider === 'openrouter' ? { 'HTTP-Referer': 'https://mdduck.com', 'X-Title': 'MD Duck' } : {})
      },
      body: JSON.stringify({
        model, messages, stream: false, temperature: options.temperature ?? 0.2,
        ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
        ...(credentials.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {})
      })
    })
    if (signal.aborted) throw new Error(options.signal?.aborted ? 'ERR_CANCELLED' : 'ERR_TIMEOUT')
    if (response.status === 401 || response.status === 403) throw new Error('ERR_BAD_KEY')
    if (response.status === 402) throw new Error('ERR_NO_CREDIT')
    if (response.status === 429) throw new Error('ERR_RATE_LIMIT')
    if (response.status === 400 || response.status === 404) throw new Error('ERR_MODEL')
    if (response.status === 408 || response.status === 504) throw new Error('ERR_TIMEOUT')
    if (!response.ok) throw new Error(`ERR_STATUS:${response.status}`)
    const payload = await limitedJSON(response)
    if (!object(payload) || !Array.isArray(payload.choices) || !object(payload.choices[0]) || !object(payload.choices[0].message)) throw new Error('ERR_BAD_RESPONSE')
    if (payload.choices[0].finish_reason === 'length') throw new Error('ERR_TRUNCATED')
    const text = payload.choices[0].message.content
    if (text === null || text === undefined || text === '') throw new Error('ERR_NO_TEXT')
    if (typeof text !== 'string') throw new Error('ERR_BAD_RESPONSE')
    if (!text.trim()) throw new Error('ERR_NO_TEXT')
    return text
  } catch (error) {
    if (options.signal?.aborted) throw new Error('ERR_CANCELLED')
    if (timeout.aborted) throw new Error('ERR_TIMEOUT')
    throw new Error(aiErrorCode(error))
  }
}

export function createAIService(options: Options) {
  let provider: AIProvider = 'openrouter'
  const profiles = Object.fromEntries(providers.map((name) => [name, { baseUrl: AI_PRESETS[name].baseUrl, model: AI_PRESETS[name].model, key: '', hasKey: false, status: 'unconfigured' }])) as Record<AIProvider, PrivateProfile>
  let version = 0
  let disposed = false
  let initialized = false
  let storageFailed = false
  let testController: AbortController | undefined
  let authController: AbortController | undefined
  let writes: Promise<void> = Promise.resolve()

  function state(): AISettings {
    return { provider, profiles: Object.fromEntries(providers.map((name) => {
      const { key: _key, encryptedKey: _encrypted, ...profile } = profiles[name]
      return [name, storageFailed ? { ...profile, hasKey: false, status: 'error', error: 'ERR_STORAGE' } : { ...profile }]
    })) as Record<AIProvider, AIProfile> }
  }
  function notify() { options.onChange?.(state()) }
  function ensure() {
    if (storageFailed) throw new Error('ERR_STORAGE')
    if (!initialized || disposed) throw new Error('ERR_CONFIG')
  }
  function cancelAuth() { authController?.abort(); authController = undefined }
  function invalidate() { version++; testController?.abort(); testController = undefined; cancelAuth() }
  function persist(): Promise<void> {
    const payload = JSON.stringify({ version: 1, provider, profiles: Object.fromEntries(providers.map((name) => [name, {
      baseUrl: profiles[name].baseUrl, model: profiles[name].model, ...(profiles[name].encryptedKey ? { encryptedKey: profiles[name].encryptedKey } : {})
    }])) }, null, 2)
    const pending = writes.then(async () => {
      const temporary = `${options.storePath}.${randomBytes(8).toString('hex')}.tmp`
      try {
        await mkdir(dirname(options.storePath), { recursive: true })
        await writeFile(temporary, payload, { mode: 0o600, flag: 'wx' })
        await rename(temporary, options.storePath)
      } catch { await rm(temporary, { force: true }).catch(() => undefined); throw new Error('ERR_STORAGE') }
    })
    writes = pending.catch(() => undefined)
    return pending
  }

  async function init() {
    try { await load(); storageFailed = false } catch (error) { storageFailed = true; throw error }
  }

  async function load() {
    if (initialized) return
    let stored: unknown
    try { stored = JSON.parse(await readFile(options.storePath, 'utf8')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('ERR_STORAGE')
    }
    if (stored !== undefined) {
      if (!object(stored) || stored.version !== 1 || !object(stored.profiles) || !providers.includes(stored.provider as AIProvider)) throw new Error('ERR_STORAGE')
      provider = stored.provider as AIProvider
      for (const name of providers) {
        const value = stored.profiles[name]
        if (!object(value)) continue
        try {
          const baseUrl = name === 'custom' && value.baseUrl === '' ? '' : normalizeAIBaseUrl(String(value.baseUrl))
          if (name !== 'custom' && baseUrl !== AI_PRESETS[name].baseUrl) throw new Error('ERR_CONFIG')
          const model = name === 'custom' && value.model === '' ? '' : validateModel(value.model)
          let key = ''
          if (value.encryptedKey !== undefined) {
            if (typeof value.encryptedKey !== 'string') throw new Error('ERR_STORAGE')
            try { key = validateKey(options.decrypt(value.encryptedKey)) } catch {
              profiles[name] = { baseUrl, model, key: '', encryptedKey: value.encryptedKey, hasKey: false, status: 'error', error: 'ERR_STORAGE' }
              continue
            }
          }
          profiles[name] = { baseUrl, model, key, encryptedKey: key ? String(value.encryptedKey) : undefined, hasKey: !!key, status: key ? 'untested' : 'unconfigured' }
        } catch { profiles[name].status = 'error'; profiles[name].error = 'ERR_CONFIG' }
      }
    } else if (options.legacy?.key) {
      try {
        const key = validateKey(options.legacy.key)
        const encryptedKey = options.encrypt(key)
        if (!encryptedKey || encryptedKey === key) throw new Error('ERR_STORAGE')
        profiles.openrouter = { ...profiles.openrouter, key, encryptedKey, model: options.legacy.model ? validateModel(options.legacy.model) : AI_PRESETS.openrouter.model, hasKey: true, status: 'untested' }
        await persist()
      } catch { throw new Error('ERR_STORAGE') }
    }
    initialized = true
    notify()
  }

  async function save(input: AIConfigInput): Promise<AISettings> {
    ensure()
    if (!input || !providers.includes(input.provider)) throw new Error('ERR_CONFIG')
    const selected = input.provider
    const baseUrl = normalizeAIBaseUrl(input.baseUrl)
    if (selected !== 'custom' && baseUrl !== AI_PRESETS[selected].baseUrl) throw new Error('ERR_CONFIG')
    const model = validateModel(input.model)
    const oldProvider = provider
    const previous = profiles[selected]
    const key = input.key === undefined ? previous.key : input.key === null ? '' : validateKey(input.key)
    let encryptedKey = input.key === null ? undefined : previous.encryptedKey
    if (key !== previous.key || (key && !encryptedKey)) {
      try { encryptedKey = key ? options.encrypt(key) : undefined } catch { throw new Error('ERR_STORAGE') }
      if (key && (!encryptedKey || encryptedKey === key)) throw new Error('ERR_STORAGE')
    }
    invalidate()
    const revision = version
    provider = selected
    profiles[selected] = { baseUrl, model, key, encryptedKey, hasKey: !!key, status: key ? 'untested' : 'unconfigured' }
    try { await persist() } catch (error) {
      if (version === revision) { provider = oldProvider; profiles[selected] = previous; notify() }
      throw error
    }
    if (version === revision) notify()
    return state()
  }

  function credentials(): AICredentials {
    ensure()
    const profile = profiles[provider]
    return { provider, baseUrl: profile.baseUrl, model: profile.model, key: profile.key }
  }

  async function test(): Promise<AISettings> {
    ensure()
    testController?.abort()
    const controller = new AbortController()
    testController = controller
    const revision = version
    const selected = provider
    try {
      await requestChat(credentials(), [{ role: 'user', content: 'Reply with OK.' }], { maxTokens: 32, temperature: 0, signal: controller.signal, timeoutMs: options.requestTimeoutMs ?? 30000, fetcher: options.fetcher })
      if (disposed || version !== revision || testController !== controller) return state()
      profiles[selected].status = 'connected'
      delete profiles[selected].error
    } catch (error) {
      if (disposed || version !== revision || testController !== controller) return state()
      const code = aiErrorCode(error)
      profiles[selected].status = code === 'NO_KEY' ? 'unconfigured' : 'error'
      profiles[selected].error = code
    } finally { if (testController === controller) testController = undefined }
    notify()
    return state()
  }

  async function connectOpenRouter(): Promise<AISettings> {
    ensure()
    invalidate()
    const revision = version
    const controller = new AbortController()
    authController = controller
    try {
      const key = await authorizeOpenRouter({ openExternal: options.openExternal, fetcher: options.fetcher, timeoutMs: options.authTimeoutMs, signal: controller.signal })
      if (disposed || version !== revision || authController !== controller || controller.signal.aborted) throw new Error('ERR_CANCELLED')
      authController = undefined
      await save({ provider: 'openrouter', baseUrl: AI_PRESETS.openrouter.baseUrl, model: profiles.openrouter.model, key })
      if (disposed || version !== revision + 1 || provider !== 'openrouter') return state()
      return test()
    } finally { if (authController === controller) authController = undefined }
  }

  function dispose() { disposed = true; invalidate() }
  return { init, state, save, test, credentials, connectOpenRouter, cancelAuth, dispose }
}
