import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { listPackage, extractFile } = require('@electron/asar')
const app = resolve(process.argv[2] ?? 'release/mac-arm64/MD Duck.app')
const resources = join(app, 'Contents/Resources')
const asar = join(resources, 'app.asar')
const unpacked = `${asar}.unpacked`
const files = listPackage(asar)
const metadata = JSON.parse(extractFile(asar, 'package.json').toString())
const expected = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
assert.equal(metadata.name, 'md-duck')
assert.equal(metadata.version, expected.version, 'The package must match the current project version')
assert(metadata.version.includes('beta'), 'The package should identify a beta version')
assert.equal(metadata.license, 'GPL-3.0-or-later')
for (const name of ['LICENSE', 'NOTICE', 'INSTALLING.md']) {
  assert.equal(readFileSync(join(resources, name), 'utf8'), readFileSync(resolve(name), 'utf8'), `Packaged ${name} must match its source`)
}
const notices = JSON.parse(readFileSync(join(resources, 'third-party/manifest.json'), 'utf8'))
assert.equal(notices.application.version, expected.version)
assert(files.includes('/out/main/index.js'))
assert(files.includes('/out/preload/index.js'))
assert(files.some((file) => /^\/out\/main\/speech-worker-[^/]+\.js$/.test(file)))
assert(files.includes('/out/renderer/index.html'))
const privateFiles = files.filter((file) => /^\/(?:website|release-audit-|\.env|\.git|settings\.json|ai-settings\.json)/.test(file) || /\/(?:\.review|note-backups|review-backups|speech-cache|kokoro-cache)\//.test(file))
assert.deepEqual(privateFiles, [], 'User data or development artifacts must not be packaged')
assert(existsSync(join(resources, 'examples/christmas-ribbon/article.md')))
assert(existsSync(join(resources, 'examples/christmas-ribbon/assets/bow.png')))
assert(existsSync(join(resources, 'third-party/ipa-dict/LICENSE-UK-GPL-3.0')))
assert(existsSync(join(resources, 'third-party/ipa-dict/en_UK.txt')))
assert(readdirSync(join(resources, 'third-party')).length > 1)
const native = join(unpacked, 'node_modules/onnxruntime-node/bin/napi-v3/darwin/arm64/onnxruntime_binding.node')
assert(existsSync(native), 'The arm64 ONNX binding must be unpacked')
assert(execFileSync('file', [native], { encoding: 'utf8' }).includes('arm64'))
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' })
const info = execFileSync('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')], { encoding: 'utf8' })
const bundle = JSON.parse(info)
assert.equal(bundle.CFBundleIdentifier, 'com.mdduck.desktop')
assert.equal(bundle.CFBundleShortVersionString, metadata.version)
console.log(JSON.stringify({ version: metadata.version, packagedFiles: files.length, architecture: 'arm64', minimumMacOS: bundle.LSMinimumSystemVersion, resources: 'present', privateFiles: 0, projectLicense: metadata.license, codeSignature: 'verified (local ad-hoc)', missingThirdPartyLicenseTexts: notices.missingFullLicenseText.map(({ name, version }) => `${name}@${version}`), remainingThirdPartyReleaseItems: (notices.releaseAudit?.remainingItems ?? []).map(({ id }) => id), notarized: false }, null, 2))
