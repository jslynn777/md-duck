#!/usr/bin/env node
// Copy only exact public source archives and provenance; never inspect app state.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argument = (name) => { const i = args.indexOf(name); assert(i >= 0 && args[i + 1], `Required argument: ${name}`); return resolve(args[i + 1]) }
const archiveRoot = argument('--archives')
const destination = argument('--output')
const audit = JSON.parse(await fs.readFile(join(root, 'scripts/notices-sources/release-audit.json'), 'utf8'))
const inputs = audit.correspondingSource.inputs
assert.equal(inputs.length, 3, 'Exactly the engine, Emscripten and original Kokoro source inputs are expected')
const target = join(destination, 'third-party/source-archives')
await fs.mkdir(target, { recursive: true })
for (const directory of [join(destination, 'third-party'), target]) assert((await fs.lstat(directory)).isDirectory(), 'Source output must be a real directory')
for (const name of await fs.readdir(target)) assert(inputs.some(({ file }) => file === name), 'Unexpected file in selected source archive output')
for (const name of await fs.readdir(join(destination, 'third-party'))) assert(['source-archives', 'SOURCE-INPUTS.json', 'README.md'].includes(name), 'Unexpected file in selected third-party output')
for (const source of inputs) {
  assert(/^[a-z0-9.-]+\.(tar\.gz|tgz)$/.test(source.file), 'Unexpected source archive name')
  const selected = join(archiveRoot, source.file)
  assert((await fs.lstat(selected)).isFile(), 'Source archive must be a regular file')
  const bytes = await fs.readFile(selected)
  assert.equal(bytes.length, source.bytes, `Source archive size differs: ${source.file}`)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, `Source archive hash differs: ${source.file}`)
  if (source.integrity) assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, source.integrity, 'Original Kokoro npm integrity differs')
  await fs.writeFile(join(target, source.file), bytes)
}
await fs.writeFile(join(destination, 'third-party/SOURCE-INPUTS.json'), JSON.stringify({ formatVersion: 1, applicationVersion: audit.correspondingSource.artifactName, inputs, engine: audit.speechSource, modelVoiceSource: audit.modelVoiceSource }, null, 2) + '\n')
await fs.writeFile(join(destination, 'third-party/README.md'), `# Exact neural speech source inputs\n\nMerge this directory with the complete MD Duck source at the binary's Git revision. SOURCE-INPUTS.json records source archive byte counts, hashes, the fixed compiler image, source-built engine outputs, and model/voice provenance. source-archives/ contains the complete ephone/eSpeak NG source with all English/Unicode/build inputs, complete Emscripten runtime source, and integrity-verified original Kokoro package material. These are public upstream sources, not user model/audio caches. The original Kokoro archive can contain historical implementation dependencies; it is provenance material and is not packaged as executable app code.\n\nFrom the combined source root, follow src/main/kokoro-runtime-phonemizer/SOURCE.md and PACKAGING.md. Reproduce the GPL engine with:\n\n    node scripts/build-phonemizer.mjs --archive third-party/source-archives/ephone-js-4f6d246.tar.gz --verify\n\nThe source package also preserves every original license and per-file header in these unmodified source archives. Runtime notice inventory is regenerated from package-lock.json with npm ci, then node scripts/collect-notices.mjs --release-strict. Keep Electron's LICENSE and LICENSES.chromium.html with every app distribution. Ordinary readers do not need Docker or a compiler. Public binaries must be accompanied by this full matching source download, not only upstream links.\n`)
console.log(JSON.stringify({ status: 'passed', destination, selectedArchives: inputs.map(({ file, sha256 }) => ({ file, sha256 })), appSource: 'Must be added from the final binary Git revision before public delivery', excluded: 'All other archives, audit logs, user profiles, API credentials and model/audio caches' }, null, 2))
