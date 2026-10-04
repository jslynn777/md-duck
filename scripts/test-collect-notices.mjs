import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const write = async (path, value) => {
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
}
const fixtures = []
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'md-duck-notice-test-'))
  fixtures.push(root)
  await write(join(root, 'scripts/collect-notices.mjs'), await fs.readFile(join(project, 'scripts/collect-notices.mjs'), 'utf8'))
  await write(join(root, 'package.json'), { name: 'notice-fixture', version: '0.1.0' })
  const native = '@img/sharp-libvips-darwin-arm64'
  await write(join(root, 'package-lock.json'), { lockfileVersion: 3, packages: {
    '': { name: 'notice-fixture', version: '0.1.0' },
    [`node_modules/${native}`]: { version: '1.3.4', license: 'LGPL-3.0-or-later' },
    'node_modules/no-license': { version: '1.0.0', license: 'ISC' }
  } })
  await write(join(root, `node_modules/${native}/package.json`), { name: native, version: '1.3.4', license: 'LGPL-3.0-or-later' })
  await write(join(root, `node_modules/${native}/versions.json`), { glib: '1.0.0' })
  await write(join(root, `node_modules/${native}/README.md`), 'Native fixture README\n')
  await write(join(root, 'node_modules/no-license/package.json'), { name: 'no-license', version: '1.0.0', license: 'ISC' })
  const text = 'Fixture license copyright and permission text retained verbatim.\n'
  await write(join(root, 'scripts/notices-sources/glib-LICENSE'), text)
  await write(join(root, 'scripts/notices-sources/manifest.json'), [{ file: 'glib-LICENSE',
    source: 'https://example.test/COPYING?format=TEXT&token=fixture-redacted',
    kind: 'license', appliesTo: [`${native}@1.3.4`], component: 'glib', componentVersion: '1.0.0', sha256: hash(text) }])
  await write(join(root, 'scripts/notices-sources/release-audit.json'), { formatVersion: 1, checkedAt: '2026-10-05',
    nativePackages: [{ name: native, version: '1.3.4', components: [{ name: 'glib', version: '1.0.0', sourceArchive: 'https://example.test/glib-1.0.0.tar.xz' }] }],
    remainingItems: [{ id: 'FIXTURE-SOURCE', summary: 'Matching source is not delivered', resolution: ['Deliver source'] }] })
  for (const name of ['SOURCE.md', 'LICENSE', 'LICENSE-UK-GPL-3.0', 'UPSTREAM-README.md', 'en_US.txt', 'en_UK.txt']) {
    await write(join(root, 'src/main/data/ipa-dict', name), `Fixture ${name}\n`)
  }
  return root
}
const run = (root, ...args) => spawnSync(process.execPath, [join(root, 'scripts/collect-notices.mjs'), ...args], { encoding: 'utf8' })
let checks = 0
try {
  const normal = await fixture()
  assert.equal(run(normal).status, 0)
  const generated = JSON.parse(await fs.readFile(join(normal, 'build/third-party/manifest.json'), 'utf8'))
  assert.equal(generated.missingFullLicenseText[0].name, 'no-license')
  assert.equal(generated.nativeComponents[0].sourceEvidence.components[0].notices.length, 1)
  const notice = generated.nativeComponents[0].sourceEvidence.components[0].notices[0]
  assert.equal(notice.source, 'https://example.test/COPYING?format=TEXT')
  assert.equal(hash(await fs.readFile(join(normal, 'build/third-party', notice.file))), notice.sha256)
  assert.equal(JSON.stringify(generated).includes(normal), false)
  checks++

  assert.equal(run(normal, '--strict').status, 1, 'Missing npm license must fail --strict')
  await write(join(normal, 'node_modules/no-license/LICENSE'), 'Fixture ISC full text\n')
  assert.equal(run(normal, '--strict').status, 0, 'Basic strict must pass once npm texts are present')
  assert.equal(run(normal, '--release-strict').status, 1, 'Unresolved embedded/source review must still fail release strict')
  checks++

  const stale = await fixture()
  await write(join(stale, 'node_modules/@img/sharp-libvips-darwin-arm64/versions.json'), { glib: '2.0.0' })
  const mismatch = run(stale)
  assert.notEqual(mismatch.status, 0)
  assert.match(mismatch.stderr, /does not match installed component versions/)
  checks++

  const tampered = await fixture()
  await write(join(tampered, 'scripts/notices-sources/glib-LICENSE'), 'Changed license bytes\n')
  const badHash = run(tampered)
  assert.notEqual(badHash.status, 0)
  assert.match(badHash.stderr, /Supplement hash mismatch/)
  checks++

  const escaped = await fixture()
  const outside = 'Fixture outside allowlist\n'
  await write(join(escaped, 'scripts/outside-LICENSE'), outside)
  await write(join(escaped, 'scripts/notices-sources/manifest.json'), [{ file: '../outside-LICENSE', source: 'https://example.test/LICENSE', kind: 'license',
    appliesTo: ['@img/sharp-libvips-darwin-arm64@1.3.4'], sha256: hash(outside) }])
  const escape = run(escaped)
  assert.notEqual(escape.status, 0)
  assert.match(escape.stderr, /escapes its allowlisted source directory/)
  checks++

  const redirected = await fixture()
  const target = await fs.mkdtemp(join(tmpdir(), 'md-duck-notice-sentinel-'))
  fixtures.push(target)
  await write(join(target, 'keep.txt'), 'Keep this file\n')
  await fs.mkdir(join(redirected, 'build'))
  await fs.symlink(target, join(redirected, 'build/third-party'))
  const symlink = run(redirected)
  assert.notEqual(symlink.status, 0)
  assert.match(symlink.stderr, /output must not be a symlink/)
  assert.equal(await fs.readFile(join(target, 'keep.txt'), 'utf8'), 'Keep this file\n')
  checks++

  const changedPackage = await fixture()
  const packageReadme = 'Published README bytes\n'
  await write(join(changedPackage, 'node_modules/no-license/README.md'), packageReadme)
  const provenance = JSON.stringify({ name: 'no-license', version: '1.0.0', archive: {},
    installedFiles: [{ file: 'README.md', sha256: hash(packageReadme) }] }) + '\n'
  await write(join(changedPackage, 'scripts/notices-sources/published.json'), provenance)
  const supplements = JSON.parse(await fs.readFile(join(changedPackage, 'scripts/notices-sources/manifest.json'), 'utf8'))
  supplements.push({ file: 'published.json', source: 'https://example.test/package', kind: 'reference',
    appliesTo: ['no-license@1.0.0'], sha256: hash(provenance), verifyPublishedPackageFiles: true })
  await write(join(changedPackage, 'scripts/notices-sources/manifest.json'), supplements)
  assert.equal(run(changedPackage).status, 0)
  await write(join(changedPackage, 'node_modules/no-license/README.md'), 'Changed installed README\n')
  const changedBytes = run(changedPackage)
  assert.notEqual(changedBytes.status, 0)
  assert.match(changedBytes.stderr, /Installed file differs from published-package evidence/)
  checks++
  console.log(`Notice collector: ${checks} verification groups passed (verbatim copies, strict boundaries, stale versions, tampering, path escape, redirected output, installed file drift).`)
} finally {
  await Promise.all(fixtures.map((root) => fs.rm(root, { recursive: true, force: true })))
}
