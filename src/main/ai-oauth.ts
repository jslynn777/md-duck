import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

type OAuthOptions = {
  openExternal: (url: string) => void | Promise<void>
  fetcher?: Fetcher
  timeoutMs?: number
  signal?: AbortSignal
}

/** The browser callback is confined to a single, temporary loopback listener. */
export async function authorizeOpenRouter(options: OAuthOptions): Promise<string> {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const nonce = randomBytes(32).toString('base64url')
  const callbackPath = `/oauth/${randomBytes(24).toString('base64url')}`
  const controller = new AbortController()
  let server: Server | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let consumed = false
  let expectedHost = ''
  let rejectResult!: (error: Error) => void
  let resolveResult!: (key: string) => void
  const result = new Promise<string>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
  // Install a rejection observer before awaiting server startup/browser opening.
  void result.catch(() => undefined)
  const finish = (error?: string, key?: string) => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
    controller.abort()
    server?.close()
    server?.closeAllConnections()
    if (error) rejectResult(new Error(error))
    else resolveResult(key!)
  }
  const cancel = () => finish('ERR_CANCELLED')
  if (options.signal?.aborted) { cancel(); return result }
  options.signal?.addEventListener('abort', cancel, { once: true })
  timer = setTimeout(() => finish('ERR_AUTH_TIMEOUT'), options.timeoutMs ?? 180000)
  timer.unref?.()
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    const invalid = () => { response.statusCode = 400; response.end('Invalid authorization callback.') }
    if (request.method !== 'GET' || request.headers.host !== expectedHost || request.socket.remoteAddress !== '127.0.0.1') return invalid()
    let callback: URL
    try { callback = new URL(request.url ?? '', `http://${expectedHost}`) } catch { return invalid() }
    if (callback.origin !== `http://${expectedHost}` || callback.pathname !== callbackPath || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== nonce) return invalid()
    if (consumed || settled) { response.statusCode = 409; response.end('Authorization already received.'); return }
    if (callback.searchParams.has('error')) { response.end('Authorization was not completed. Return to MD Duck.'); finish('ERR_AUTH'); return }
    const codes = callback.searchParams.getAll('code')
    if (codes.length !== 1 || !codes[0] || codes[0].length > 4096 || /[\u0000-\u0020\u007f]/.test(codes[0])) return invalid()
    consumed = true
    response.end('Authorization received. You can close this tab and return to MD Duck.')
    void (async () => {
      try {
        const exchange = await (options.fetcher ?? fetch)('https://openrouter.ai/api/v1/auth/keys', {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: codes[0], code_verifier: verifier, code_challenge_method: 'S256' })
        })
        if (!exchange.ok) return finish('ERR_AUTH')
        const raw = await exchange.text()
        if (raw.length > 16384) return finish('ERR_AUTH')
        const body: unknown = JSON.parse(raw)
        const key = typeof body === 'object' && body !== null && 'key' in body ? body.key : undefined
        if (typeof key !== 'string' || !key.trim() || key.length > 8192 || /[\u0000-\u0020\u007f]/.test(key)) return finish('ERR_AUTH')
        finish(undefined, key)
      } catch { finish(controller.signal.aborted ? 'ERR_CANCELLED' : 'ERR_AUTH') }
    })()
  })
  server.on('error', () => finish('ERR_AUTH'))
  await new Promise<void>((resolve) => {
    server!.once('error', () => resolve())
    server!.listen(0, '127.0.0.1', () => resolve())
  })
  if (settled) { server.close(); return result }
  const address = server.address()
  if (!address || typeof address === 'string') { finish('ERR_AUTH'); return result }
  expectedHost = `127.0.0.1:${address.port}`
  const callback = new URL(`http://${expectedHost}${callbackPath}`)
  callback.searchParams.set('state', nonce)
  const authorization = new URL('https://openrouter.ai/auth')
  authorization.searchParams.set('callback_url', callback.href)
  authorization.searchParams.set('code_challenge', challenge)
  authorization.searchParams.set('code_challenge_method', 'S256')
  authorization.searchParams.set('key_label', 'MD Duck')
  try { await options.openExternal(authorization.href) } catch { finish('ERR_AUTH') }
  return result
}
