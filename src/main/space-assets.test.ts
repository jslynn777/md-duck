import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPathInsideRoot } from './allowed-path'
import { createSpaceAssetRegistry } from './space-assets'

const fixtures: string[] = []
afterEach(async () => { await Promise.all(fixtures.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))) })

async function roots() {
  const temporary = await fs.mkdtemp(join(tmpdir(), 'md-duck-space-assets-'))
  fixtures.push(temporary)
  const root = await fs.realpath(temporary)
  const a = join(root, '项目 A'), b = join(root, '项目 B')
  await fs.mkdir(a); await fs.mkdir(b)
  const imageA = join(a, 'own image.png'), imageB = join(b, 'private.png')
  await fs.writeFile(imageA, 'Alpha image'); await fs.writeFile(imageB, 'Beta image')
  return { a, b, imageA, imageB }
}

function asset(scope: string, path: string, version = '17') {
  const url = new URL('md-duck://asset/')
  url.searchParams.set('scope', scope); url.searchParams.set('path', path); url.searchParams.set('v', version)
  return url.href
}

describe('space-scoped local image access', () => {
  it('authorizes only the scope owner even when both spaces are registered', async () => {
    const { a, b, imageA, imageB } = await roots()
    const registry = createSpaceAssetRegistry()
    const allowedA = vi.fn((path: string) => isPathInsideRoot(path, a))
    const allowedB = vi.fn((path: string) => isPathInsideRoot(path, b))
    const scopeA = registry.register(allowedA), scopeB = registry.register(allowedB)
    expect(scopeA).not.toBe(scopeB)
    expect(scopeA).toMatch(/^[a-f0-9-]{36}$/)
    expect(await registry.resolve(asset(scopeA, imageA))).toEqual({ path: imageA, type: 'image/png' })
    expect(await registry.resolve(asset(scopeA, imageB))).toBeNull()
    expect(allowedB).not.toHaveBeenCalled()
    expect(await registry.resolve(asset(scopeB, imageB))).toEqual({ path: imageB, type: 'image/png' })
    expect(await registry.resolve(asset(scopeB, imageA))).toBeNull()
  })

  it('refuses cross-space symlinks and returns an internal image’s canonical path', async () => {
    const { a, imageA, imageB } = await roots()
    const registry = createSpaceAssetRegistry()
    const scope = registry.register(path => isPathInsideRoot(path, a))
    const internal = join(a, 'internal.png'), escape = join(a, 'escape.png')
    await fs.symlink(imageA, internal); await fs.symlink(imageB, escape)
    expect(await registry.resolve(asset(scope, internal))).toEqual({ path: imageA, type: 'image/png' })
    expect(await registry.resolve(asset(scope, escape))).toBeNull()
    expect(await registry.resolve(asset(scope, join(a, '..', '项目 B', 'private.png')))).toBeNull()
    const missing = join(a, 'missing.png')
    expect(await registry.resolve(asset(scope, missing))).toEqual({ path: missing, type: 'image/png' })
  })

  it('uses the owning session’s current root after relocation', async () => {
    const { a, b, imageA, imageB } = await roots()
    let root = a
    const registry = createSpaceAssetRegistry(), scope = registry.register(path => isPathInsideRoot(path, root))
    expect(await registry.resolve(asset(scope, imageA))).not.toBeNull()
    root = b
    expect(await registry.resolve(asset(scope, imageA))).toBeNull()
    expect(await registry.resolve(asset(scope, imageB))).not.toBeNull()
  })

  it('revokes both new requests and permission checks already in flight', async () => {
    const { imageA } = await roots()
    let release!: (allowed: boolean) => void
    let checking!: () => void
    const started = new Promise<void>(resolve => { checking = resolve })
    const registry = createSpaceAssetRegistry()
    const scope = registry.register(() => { checking(); return new Promise(resolve => { release = resolve }) })
    const pending = registry.resolve(asset(scope, imageA))
    await started
    registry.remove(scope); release(true)
    expect(await pending).toBeNull()
    expect(await registry.resolve(asset(scope, imageA))).toBeNull()
  })

  it('fails closed when the owning permission check fails', async () => {
    const { imageA } = await roots()
    const registry = createSpaceAssetRegistry()
    const scope = registry.register(async () => { throw Error('root unavailable') })
    expect(await registry.resolve(asset(scope, imageA))).toBeNull()
  })

  it('rejects missing, unknown, duplicate or malformed authorization without checking any library', async () => {
    const { imageA } = await roots()
    const registry = createSpaceAssetRegistry(), allowed = vi.fn(async () => true)
    const scope = registry.register(allowed), valid = asset(scope, imageA)
    const cases = [
      'not a URL', valid.replace('md-duck:', 'https:'), valid.replace('//asset/', '//other/'),
      valid.replace('//asset/', '//user@asset/'), valid.replace('//asset/', '//asset:99/'),
      valid.replace('//asset/', '//asset/other'), `${valid}#fragment`, `${valid}&extra=1`,
      `${valid}&scope=${scope}`, `${valid}&path=${encodeURIComponent(imageA)}`, `${valid}&v=18`,
      valid.replace(`scope=${scope}&`, ''), valid.replace(`scope=${scope}`, 'scope=unknown'),
      asset(scope, 'relative.png'), asset(scope, `${imageA}\0`), asset(scope, `${imageA}.txt`),
      asset(scope, imageA, 'NaN'), asset(scope, imageA, '-1'), asset(scope, imageA, '')
    ]
    for (const url of cases) expect(await registry.resolve(url), url).toBeNull()
    expect(allowed).not.toHaveBeenCalled()
  })
})
