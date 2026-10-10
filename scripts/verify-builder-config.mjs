import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
export function verifyBuilderConfig(config) {
  const allowlist = ['out/**/*', 'package.json']
  // electron-builder platform files replace the common files setting. A list
  // containing exclusions only activates its default **/* inclusion, so check
  // every configured target's effective patterns before any package is built.
  for (const target of ['mac', 'win']) {
    const files = config[target]?.files ?? config.files
    assert(Array.isArray(files), `${target} must have explicit package file patterns`)
    assert.deepEqual(files.filter((file) => typeof file === 'string' && !file.startsWith('!')).sort(), [...allowlist].sort(), `${target} must package only the application build and metadata, without a default workspace inclusion`)
    for (const pattern of ['!**/*.map', '!**/*.test.*']) assert(files.includes(pattern), `${target} must exclude ${pattern}`)
  }
  for (const pattern of ['!node_modules/onnxruntime-node/bin/napi-v3/linux/**', '!node_modules/onnxruntime-node/bin/napi-v3/win32/**', '!node_modules/onnxruntime-node/bin/napi-v3/darwin/x64/**']) assert(config.mac.files.includes(pattern), `Missing macOS native filter: ${pattern}`)
  for (const pattern of ['!node_modules/onnxruntime-node/bin/napi-v3/darwin/**', '!node_modules/onnxruntime-node/bin/napi-v3/linux/**', '!node_modules/onnxruntime-node/bin/napi-v3/win32/arm64/**']) assert(config.win.files.includes(pattern), `Missing Windows native filter: ${pattern}`)
  const resources = config.extraResources.map(({ from }) => from)
  assert.deepEqual(resources, ['LICENSE', 'NOTICE', 'INSTALLING.md', 'examples', 'build/third-party', 'src/main/data/ipa-dict', 'src/main/data/kokoro-voices'], 'Only allowlisted shared resources may be copied')
  assert(config.extraResources.find(({ from }) => from === 'examples').filter.includes('!**/.review/**'))
  for (const pattern of ['out/main/speech-worker*.js', 'out/main/kokoro-runtime*.js', 'out/main/chunks/**']) assert(config.asarUnpack.includes(pattern), `Speech utility process requires ${pattern} outside ASAR`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  verifyBuilderConfig(yaml.load(readFileSync('electron-builder.yml', 'utf8')))
  console.log('Packaging allowlists and target native filters verified for macOS arm64 and Windows x64.')
}
