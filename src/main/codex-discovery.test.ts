import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverCodexExecutable } from './codex-runner'

let fixture: string
beforeEach(async () => { fixture = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'md-duck-codex-discovery-'))) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(fixture, { recursive: true, force: true }) })
async function file(path: string, content: string | Uint8Array, executable = false) {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, content, { mode: executable ? 0o755 : 0o644 })
  return path
}
async function native(path: string) { return file(path, Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]), true) }
async function npmPackage(name = '@openai/codex') {
  const root = join(fixture, 'lib', 'node_modules', '@openai', 'codex')
  await file(join(root, 'package.json'), JSON.stringify({ name, version: '0.0.0-fixture' }))
  const shim = await file(join(root, 'bin', 'codex.js'), '#!/usr/bin/env node\nthrow Error("must not run this fixture")\n', true)
  return { root, shim }
}
async function platformBinary(root: string, platform: string, arch: string, target: string) {
  const dependency = join(root, 'node_modules', '@openai', `codex-${platform}-${arch}`)
  await file(join(dependency, 'package.json'), JSON.stringify({ name: `@openai/codex-${platform}-${arch}`, version: '0.0.0-fixture' }))
  return native(join(dependency, 'vendor', target, 'bin', platform === 'win32' ? 'codex.exe' : 'codex'))
}

describe('local Codex native executable discovery', () => {
  it('finds an explicit native binary with an empty GUI PATH and follows its symlink without executing it', async () => {
    const binary = await native(join(fixture, 'native', 'codex'))
    const link = join(fixture, 'codex')
    await fs.symlink(binary, link)
    expect(await discoverCodexExecutable({ executable: link, platform: 'darwin', arch: 'arm64', env: { PATH: '' }, home: fixture })).toBe(binary)
  })

  it('resolves the current npm JS wrapper to the matching optional platform package, ahead of an older vendor copy', async () => {
    const { root, shim } = await npmPackage()
    const binary = await platformBinary(root, 'darwin', 'arm64', 'aarch64-apple-darwin')
    await native(join(root, 'vendor', 'aarch64-apple-darwin', 'bin', 'codex'))
    expect(await discoverCodexExecutable({ executable: shim, platform: 'darwin', arch: 'arm64' })).toBe(binary)
  })

  it('supports npm packages with the historical bundled vendor directory', async () => {
    const { root, shim } = await npmPackage()
    const binary = await native(join(root, 'vendor', 'x86_64-apple-darwin', 'bin', 'codex'))
    expect(await discoverCodexExecutable({ executable: shim, platform: 'darwin', arch: 'x64' })).toBe(binary)
  })

  it('maps a Windows npm .cmd wrapper directly to its native exe without requiring a shell or node', async () => {
    const npm = join(fixture, 'appdata', 'npm'), root = join(npm, 'node_modules', '@openai', 'codex')
    await file(join(npm, 'codex.cmd'), '@ECHO OFF\r\nnode fixture-that-must-not-run\r\n')
    await file(join(root, 'package.json'), JSON.stringify({ name: '@openai/codex' }))
    const binary = await platformBinary(root, 'win32', 'x64', 'x86_64-pc-windows-msvc')
    expect(await discoverCodexExecutable({ platform: 'win32', arch: 'x64', env: { Path: `${join(fixture, 'missing')};${npm}` }, home: fixture })).toBe(binary)
  })

  it('supports Windows ARM64 and the npm APPDATA fallback when PATH is empty', async () => {
    const appdata = join(fixture, 'appdata'), npm = join(appdata, 'npm'), root = join(npm, 'node_modules', '@openai', 'codex')
    await file(join(npm, 'codex.cmd'), '@ECHO OFF\r\n')
    await file(join(root, 'package.json'), JSON.stringify({ name: '@openai/codex' }))
    const binary = await native(join(root, 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe'))
    expect(await discoverCodexExecutable({ platform: 'win32', arch: 'arm64', env: { PATH: '', APPDATA: appdata }, home: fixture })).toBe(binary)
  })

  it('finds the Homebrew npm wrapper from the fixed GUI fallback location without reading a real installation', async () => {
    const { root, shim } = await npmPackage()
    const binary = await platformBinary(root, 'darwin', 'arm64', 'aarch64-apple-darwin')
    const actualRealpath = fs.realpath.bind(fs)
    // The simulated macOS candidate is still joined by the host's path module.
    // Match that spelling on Windows too, without touching a real installation.
    const fallback = join('/opt/homebrew/bin', 'codex')
    const realpath = vi.spyOn(fs, 'realpath').mockImplementation(async (path, ...rest) => String(path) === fallback ? shim : actualRealpath(path, ...rest))
    expect(await discoverCodexExecutable({ platform: 'darwin', arch: 'arm64', env: { PATH: '' }, home: fixture })).toBe(binary)
    expect(realpath).toHaveBeenCalledWith(fallback)
  })

  it('does not accept a missing binary, a directory, or a wrapper whose package name is wrong', async () => {
    expect(await discoverCodexExecutable({ executable: join(fixture, 'missing') })).toBeNull()
    expect(await discoverCodexExecutable({ executable: fixture })).toBeNull()
    const { root, shim } = await npmPackage('not-codex')
    await native(join(root, 'vendor', 'aarch64-apple-darwin', 'bin', 'codex'))
    expect(await discoverCodexExecutable({ executable: shim, platform: 'darwin', arch: 'arm64' })).toBeNull()
  })

  it('rejects malformed or missing wrapper metadata and absent matching native packages', async () => {
    const { root, shim } = await npmPackage()
    expect(await discoverCodexExecutable({ executable: shim, platform: 'darwin', arch: 'arm64' })).toBeNull()
    await native(join(root, 'vendor', 'aarch64-apple-darwin', 'bin', 'codex'))
    await fs.writeFile(join(root, 'package.json'), '{broken')
    expect(await discoverCodexExecutable({ executable: shim, platform: 'darwin', arch: 'arm64' })).toBeNull()
    await fs.unlink(join(root, 'package.json'))
    expect(await discoverCodexExecutable({ executable: shim, platform: 'darwin', arch: 'arm64' })).toBeNull()
  })
})
