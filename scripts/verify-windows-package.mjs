import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createReadStream, existsSync, openSync, readSync, closeSync, readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { listPackage, extractFile } = require('@electron/asar')
const { path7za } = require('7zip-bin')
const expected = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const app = resolve(process.argv.find((value, index) => index > 1 && !value.startsWith('--')) ?? 'release/win-unpacked')
const resources = join(app, 'resources')
const asar = join(resources, 'app.asar')
const unpacked = `${asar}.unpacked`
const files = listPackage(asar)
const metadata = JSON.parse(extractFile(asar, 'package.json').toString())

function peMachine(file) {
  const descriptor = openSync(file, 'r')
  try {
    const header = Buffer.alloc(64)
    assert.equal(readSync(descriptor, header, 0, header.length, 0), header.length)
    assert.equal(header.toString('ascii', 0, 2), 'MZ', `Not a Windows executable: ${file}`)
    const offset = header.readUInt32LE(0x3c)
    const signature = Buffer.alloc(6)
    assert.equal(readSync(descriptor, signature, 0, signature.length, offset), signature.length)
    assert.deepEqual(signature.subarray(0, 4), Buffer.from('PE\0\0'))
    return signature.readUInt16LE(4)
  } finally { closeSync(descriptor) }
}
async function sha256(file) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(file)) hash.update(bytes)
  return hash.digest('hex')
}
function extract(archive, destination) {
  const result = spawnSync(path7za, ['x', '-y', '-bd', `-o${destination}`, archive], { encoding: 'utf8', timeout: 180_000, windowsHide: true })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Could not extract ${archive}: ${result.stderr || result.stdout}`)
}
async function locate(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isFile() && entry.name === name) return file
    if (entry.isDirectory()) {
      const found = await locate(file, name)
      if (found) return found
    }
  }
  return null
}

assert.equal(metadata.name, 'md-duck')
assert.equal(metadata.version, expected.version, 'The package must match the project version')
assert.equal(metadata.license, 'GPL-3.0-or-later')
assert.equal(peMachine(join(app, 'MD Duck.exe')), 0x8664, 'The application executable must be Windows x64')
for (const name of ['LICENSE', 'NOTICE', 'INSTALLING.md']) {
  assert.equal(readFileSync(join(resources, name), 'utf8'), readFileSync(resolve(name), 'utf8'), `Packaged ${name} must match its source`)
}
for (const file of ['/out/main/index.js', '/out/preload/index.js', '/out/renderer/index.html']) assert(files.includes(file), `Missing ${file}`)
assert(files.some((file) => /^\/out\/main\/speech-worker-[^/]+\.js$/.test(file)))
const privateFiles = files.filter((file) => /^\/(?:website|release-audit-|\.env|\.git|settings\.json|ai-settings\.json)/.test(file) || /\/(?:\.review|note-backups|review-backups|speech-cache|kokoro-cache)\//.test(file))
assert.deepEqual(privateFiles, [], 'User data or development artifacts must not be packaged')
assert(!files.some((file) => /\/onnxruntime-node\/bin\/napi-v3\/(?:darwin|linux)\//.test(file) || /\/onnxruntime-node\/bin\/napi-v3\/win32\/arm64\//.test(file)), 'Other-platform ONNX binaries must not be included')
for (const file of [
  'node_modules/onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime_binding.node',
  'node_modules/onnxruntime-node/bin/napi-v3/win32/x64/onnxruntime.dll',
  'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node',
  'node_modules/@img/sharp-win32-x64/lib/libvips-42.dll',
  'node_modules/@img/sharp-win32-x64/lib/libvips-cpp-8.18.7.dll'
]) assert.equal(peMachine(join(unpacked, file)), 0x8664, `Native dependency must be x64 and unpacked: ${file}`)
for (const file of ['examples/christmas-ribbon/article.md', 'examples/christmas-ribbon/assets/bow.png', 'third-party/ipa-dict/LICENSE-UK-GPL-3.0', 'third-party/ipa-dict/en_UK.txt']) assert(existsSync(join(resources, file)), `Missing resource: ${file}`)
for (const file of ['LICENSE', 'LICENSES.chromium.html']) assert(existsSync(join(app, file)), `Missing Electron notice: ${file}`)
const notices = JSON.parse(readFileSync(join(resources, 'third-party/manifest.json'), 'utf8'))
assert.equal(notices.application.version, expected.version)
assert.equal(notices.platform, 'win32', 'Notices must be generated on the Windows build host')
assert.equal(notices.architecture, 'x64')
assert(notices.nativeComponents.some(({ name }) => name === '@img/sharp-win32-x64'), 'The bundled Windows libvips inventory must be collected')

const artifacts = []
if (!process.argv.includes('--dir-only')) {
  const archiveDirectory = resolve('release')
  for (const target of ['Setup', 'Portable']) {
    const name = `MD-Duck-${metadata.version}-Windows-x64-${target}-local-test.exe`
    const archive = join(archiveDirectory, name)
    assert(existsSync(archive), `Missing ${target} artifact: ${name}`)
    assert([0x14c, 0x8664].includes(peMachine(archive)), 'The NSIS launcher must be a Windows executable')
    const directory = await mkdtemp(join(tmpdir(), `md-duck-${target.toLowerCase()}-verification-`))
    try {
      const shell = join(directory, 'shell')
      extract(archive, shell)
      // electron-builder embeds the same architecture-specific payload in both targets.
      const payload = await locate(shell, 'app-64.7z')
      assert(payload, `${target} does not contain its Windows x64 application payload`)
      const extracted = join(directory, 'payload')
      extract(payload, extracted)
      const packagedAsar = await locate(extracted, 'app.asar')
      assert(packagedAsar, `${target} has no app.asar`)
      assert.equal(await sha256(packagedAsar), await sha256(asar), `${target} contains a different app.asar`)
      const executable = await locate(extracted, 'MD Duck.exe')
      assert(executable, `${target} has no application executable`)
      assert.equal(await sha256(executable), await sha256(join(app, 'MD Duck.exe')), `${target} executable differs from win-unpacked`)
      for (const basename of ['onnxruntime_binding.node', 'onnxruntime.dll', 'libvips-42.dll', 'libvips-cpp-8.18.7.dll']) {
        const original = await locate(unpacked, basename)
        const bundled = await locate(extracted, basename)
        assert(original && bundled, `${target} is missing ${basename}`)
        assert.equal(await sha256(bundled), await sha256(original), `${target} native dependency differs: ${basename}`)
      }
      const digest = await sha256(archive)
      const checksums = readFileSync(join(archiveDirectory, 'SHA256SUMS'), 'utf8').split(/\r?\n/)
      assert(checksums.includes(`${digest}  ${name}`), `${target} checksum file is missing or differs`)
      artifacts.push({ file: name, sha256: digest, payload: 'matches unpacked application' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
}
console.log(JSON.stringify({ status: 'passed', version: metadata.version, platform: 'win32', architecture: 'x64', packagedFiles: files.length, privateFiles: 0, notices: 'Windows native inventory present', codeSigned: false, artifacts, remainingThirdPartyReleaseItems: (notices.releaseAudit?.remainingItems ?? []).map(({ id }) => id), scope: 'Package and archive integrity; runtime startup and speech checks run separately.' }, null, 2))
