import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { authorizeOpenRouter } from './ai-oauth'

function callbackFrom(url: string): URL { return new URL(new URL(url).searchParams.get('callback_url')!) }

describe('OpenRouter browser authorization', () => {
  it('verifies the temporary callback state and exchanges code with the matching S256 verifier once', async () => {
    let authUrl: URL | undefined
    let responseText = ''
    const exchange = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.code).toBe('fixture-auth-code')
      expect(body.code_challenge_method).toBe('S256')
      expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(authUrl?.searchParams.get('code_challenge'))
      expect(init?.redirect).toBe('error')
      return new Response(JSON.stringify({ key: 'fixture-auth-secret' }))
    })
    const key = await authorizeOpenRouter({
      fetcher: exchange,
      openExternal: async (url) => {
        authUrl = new URL(url)
        expect(authUrl.origin).toBe('https://openrouter.ai')
        expect(authUrl.pathname).toBe('/auth')
        const callback = callbackFrom(url)
        expect(callback.hostname).toBe('127.0.0.1')
        callback.searchParams.set('code', 'fixture-auth-code')
        const wrongState = new URL(callback)
        wrongState.searchParams.set('state', 'wrong-state')
        expect((await fetch(wrongState)).status).toBe(400)
        expect(exchange).not.toHaveBeenCalled()
        const wrongPath = new URL(callback)
        wrongPath.pathname = '/other-callback'
        expect((await fetch(wrongPath)).status).toBe(400)
        const response = await fetch(callback)
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
        responseText = await response.text()
      }
    })
    expect(key).toBe('fixture-auth-secret')
    expect(exchange).toHaveBeenCalledTimes(1)
    expect(exchange.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/auth/keys')
    expect(responseText).not.toMatch(/fixture-auth-(?:code|secret)/)
    await expect(fetch(callbackFrom(authUrl!.href))).rejects.toThrow()
  })

  it('cancels and times out abandoned browser sessions, closing their listeners', async () => {
    for (const action of ['cancel', 'timeout']) {
      const controller = new AbortController()
      let callback: URL | undefined
      const pending = authorizeOpenRouter({ signal: controller.signal, timeoutMs: 20, openExternal: async (url) => {
        callback = callbackFrom(url)
        if (action === 'cancel') controller.abort()
      } })
      await expect(pending).rejects.toThrow(action === 'cancel' ? 'ERR_CANCELLED' : 'ERR_AUTH_TIMEOUT')
      await expect(fetch(callback!)).rejects.toThrow()
    }
  })

  it('does not return provider bodies or exchange malformed callback inputs', async () => {
    const exchange = vi.fn(async () => new Response('private diagnostic', { status: 403 }))
    const pending = authorizeOpenRouter({ fetcher: exchange, openExternal: async (url) => {
      const callback = callbackFrom(url)
      callback.searchParams.set('code', 'fixture-code')
      callback.searchParams.append('code', 'duplicate-code')
      expect((await fetch(callback)).status).toBe(400)
      expect(exchange).not.toHaveBeenCalled()
      callback.searchParams.delete('code')
      callback.searchParams.set('code', 'fixture-code')
      await fetch(callback)
    } })
    await expect(pending).rejects.toThrow('ERR_AUTH')
    expect(exchange).toHaveBeenCalledTimes(1)
  })
})
