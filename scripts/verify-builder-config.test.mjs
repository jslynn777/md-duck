import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { verifyBuilderConfig } from './verify-builder-config.mjs'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const fixture = () => yaml.load(readFileSync('electron-builder.yml', 'utf8'))

test('current targets have explicit application and resource allowlists', () => {
  assert.doesNotThrow(() => verifyBuilderConfig(fixture()))
})
for (const platform of ['mac', 'win']) {
  test(`${platform} rejects exclusions-only platform files that activate electron-builder default workspace inclusion`, () => {
    const config = fixture()
    config[platform].files = config[platform].files.filter((file) => file.startsWith('!'))
    assert.throws(() => verifyBuilderConfig(config), /without a default workspace inclusion/)
  })
  test(`${platform} rejects a native filter accidentally removed from the selected target`, () => {
    const config = fixture()
    config[platform].files = config[platform].files.filter((file) => !file.includes('napi-v3/linux'))
    assert.throws(() => verifyBuilderConfig(config), /native filter/)
  })
}
test('rejects a broad resource copy that could include a local profile', () => {
  const config = fixture()
  config.extraResources.push({ from: '.', to: 'workspace' })
  assert.throws(() => verifyBuilderConfig(config), /Only allowlisted shared resources/)
})
