#!/usr/bin/env node
// Package only an explicit committed release revision plus the three verified public source inputs.
// Usage: node scripts/package-corresponding-source.mjs --revision <commit> --archives <directory> --output <directory> [--check-only]
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argument(name) {
  const index = args.indexOf(name)
  assert(index >= 0 && args[index + 1], `Missing argument: ${name}`)
  return args[index + 1]
}
const command = (file, parameters, options = {}) => execFileSync(file, parameters, { cwd: root, maxBuffer: 128 * 1024 * 1024, ...options })
const git = (...parameters) => command('git', parameters)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const gitBlob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
const revision = git('rev-parse', '--verify', `${argument('--revision')}^{commit}`).toString('utf8').trim()
assert(/^[0-9a-f]{40}$/.test(revision), 'Only an exact Git commit is accepted')
const inputArchives = resolve(root, argument('--archives'))
const destination = resolve(root, argument('--output'))
const packageJSON = JSON.parse(git('show', `${revision}:package.json`))
assert.equal(packageJSON.license, 'GPL-3.0-or-later')
assert(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.]+)?$/.test(packageJSON.version))
const audit = JSON.parse(git('show', `${revision}:scripts/notices-sources/release-audit.json`))
const sourceName = `MD-Duck-${packageJSON.version}-Source`
const filename = `MD-Duck-${packageJSON.version}-Corresponding-Source.tar.gz`
assert.equal(audit.correspondingSource.artifactName, filename)
assert.equal(audit.remainingItems.length, 0, 'Unresolved release-audit entries remain')
assert.equal(audit.correspondingSource.inputs.length, 3)
// Explicit public-source path allowlist. Only committed blobs are read; the
// current worktree, ignored output, user libraries, and profiles are never copied.
const allowedFiles = new Set([
  '.gitattributes', '.gitignore', 'INSTALLING.md', 'LICENSE', 'NOTICE',
  'PACKAGING.md', 'README.md', 'electron-builder.yml', 'electron.vite.config.ts',
  'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json',
  'tsconfig.web.json', 'vitest.config.ts'
])
const allowedDirectories = new Set(['.github', 'docs', 'examples', 'scripts', 'src', 'website'])
const expected = new Map()
for (const record of git('ls-tree', '-r', '-z', revision).toString('utf8').split('\0').filter(Boolean)) {
  const [description, path] = record.split('\t')
  const [mode, type, blob] = description.split(' ')
  assert(['100644', '100755'].includes(mode) && type === 'blob', `Source entry is not a regular blob: ${path}`)
  assert(allowedFiles.has(path) || path.includes('/') && allowedDirectories.has(path.split('/')[0]), `Unapproved source path: ${path}`)
  assert(!path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\\'))
  assert(!path.split('/').some((part) => ['.git', '.review', '.mdduck', '.ssh', '.DS_Store', 'node_modules', 'kokoro-cache', 'speech-cache', 'verification', 'release-prep', 'release-audit', 'artifacts', 'backups'].includes(part)), `Private/runtime state tracked: ${path}`)
  assert(!/^(?:release(?:\/|$)|out\/|dist\/|release-prep-|release-audit-|design-audit-|design-review-|fix-verification-|product-review-|verification\/)/.test(path), `Non-source tracked directory: ${path}`)
  assert(!path.split('/').some((part) => /^\.env(?:\.|$)/.test(part) && part !== '.env.example'), `Unexpected environment file: ${path}`)
  assert(!/\.(?:pem|p12|pfx|key|keychain|sqlite|sqlite3)$/i.test(path), `Private credential/state extension: ${path}`)
  expected.set(path, blob)
}
assert(expected.has('LICENSE') && expected.has('NOTICE') && expected.has('PACKAGING.md'))
assert(!expected.has('SOURCE_REVISION.json') && ![...expected.keys()].some((path) => path.startsWith('third-party/')))
// These include the local release audit itself. Validate every registry hash
// before packaging so provenance edits cannot leave a stale integrity record.
const supplements = JSON.parse(git('show', `${revision}:scripts/notices-sources/manifest.json`))
for (const supplement of supplements) {
  assert(typeof supplement.file === 'string' && !supplement.file.startsWith('/') && !supplement.file.includes('\\') && !supplement.file.split('/').includes('..'))
  const path = `scripts/notices-sources/${supplement.file}`
  assert(expected.has(path), `Supplement is not committed: ${path}`)
  assert.equal(sha256(git('show', `${revision}:${path}`)), supplement.sha256, `Supplement registry mismatch: ${path}`)
}
if (args.includes('--check-only')) {
  for (const input of audit.correspondingSource.inputs) {
    const path = join(inputArchives, input.file)
    assert((await fs.lstat(path)).isFile(), 'Archive input is not a regular file')
    const bytes = await fs.readFile(path)
    assert.equal(bytes.length, input.bytes)
    assert.equal(sha256(bytes), input.sha256)
    if (input.integrity) assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, input.integrity)
  }
  console.log(JSON.stringify({ status: 'preflight-passed', version: packageJSON.version, gitRevision: revision, sourceFiles: expected.size, inputArchives: audit.correspondingSource.inputs.length, assembly: 'not performed' }, null, 2))
  process.exit(0)
}
await fs.mkdir(destination, { recursive: true })
assert((await fs.lstat(destination)).isDirectory(), 'Output must be a real directory')
const working = join(destination, `source-assembly-${revision.slice(0, 12)}`)
await fs.mkdir(working) // Refuse reuse of stale staging data.
const originalTar = join(working, 'git-source.tar')
git('archive', '--format=tar', `--prefix=${sourceName}/`, `--output=${originalTar}`, revision)
command('tar', ['-xf', originalTar, '-C', working])
const sourceRoot = join(working, sourceName)
command(process.execPath, [join(sourceRoot, 'scripts/stage-neural-sources.mjs'), '--archives', inputArchives, '--output', sourceRoot])
await fs.writeFile(join(sourceRoot, 'SOURCE_REVISION.json'), JSON.stringify({
  application: 'MD Duck', version: packageJSON.version, gitRevision: revision,
  repository: 'https://github.com/jslynn777/md-duck', generatedAt: new Date().toISOString(),
  scope: 'Complete application and public website source at this recorded release Git revision, the three fixed neural engine/compiler/Kokoro source archives, notices and rebuild recipes. Excludes user profiles, API keys, private articles and model/audio caches.'
}, null, 2) + '\n')
const additions = new Set(['SOURCE_REVISION.json', 'third-party/SOURCE-INPUTS.json', 'third-party/README.md', ...audit.correspondingSource.inputs.map(({ file }) => `third-party/source-archives/${file}`)])
async function files(directory, prefix = '') {
  const result = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name
    if (entry.isDirectory()) result.push(...await files(join(directory, entry.name), path + '/'))
    else { assert(entry.isFile(), `Nonregular source member: ${path}`); result.push(path) }
  }
  return result.sort()
}
async function verify(directory) {
  const listing = await files(directory)
  assert.deepEqual(listing, [...expected.keys(), ...additions].sort(), 'Source artifact has missing or unexpected files')
  for (const [path, blob] of expected) assert.equal(gitBlob(await fs.readFile(join(directory, path))), blob, `Source differs from exact Git blob: ${path}`)
  const archiveResults = []
  for (const input of audit.correspondingSource.inputs) {
    const bytes = await fs.readFile(join(directory, 'third-party/source-archives', input.file))
    assert.equal(bytes.length, input.bytes, `Source archive byte count differs: ${input.file}`)
    assert.equal(sha256(bytes), input.sha256, `Source archive SHA256 differs: ${input.file}`)
    if (input.integrity) assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, input.integrity)
    archiveResults.push({ file: input.file, bytes: bytes.length, sha256: sha256(bytes) })
  }
  const sourceInputs = JSON.parse(await fs.readFile(join(directory, 'third-party/SOURCE-INPUTS.json'), 'utf8'))
  assert.deepEqual(sourceInputs.inputs, audit.correspondingSource.inputs)
  assert.equal(sourceInputs.applicationVersion, filename)
  assert.deepEqual(sourceInputs.engine, audit.speechSource)
  assert.deepEqual(sourceInputs.modelVoiceSource, audit.modelVoiceSource)
  const provenance = JSON.parse(await fs.readFile(join(directory, 'SOURCE_REVISION.json'), 'utf8'))
  assert.equal(provenance.gitRevision, revision)
  assert.equal(provenance.version, packageJSON.version)
  return { sourceFileCount: expected.size, addedFileCount: additions.size, totalFileCount: listing.length, archives: archiveResults }
}
await verify(sourceRoot)
command(process.execPath, [join(sourceRoot, 'scripts/verify-neural-sources.mjs'), '--archives', join(sourceRoot, 'third-party/source-archives')])
const artifact = join(destination, filename)
assert(!(await fs.stat(artifact).catch((error) => { if (error.code === 'ENOENT') return null; throw error })), 'Do not overwrite an existing public artifact')
command('tar', ['-czf', artifact, '-C', working, sourceName], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
const members = command('tar', ['-tzf', artifact]).toString('utf8').trim().split('\n')
assert(members.every((member) => member === `${sourceName}/` || member.startsWith(`${sourceName}/`) && !member.split('/').includes('..')))
const extracted = join(working, 'artifact-extracted')
await fs.mkdir(extracted)
command('tar', ['-xzf', artifact, '-C', extracted])
const verified = await verify(join(extracted, sourceName))
const bytes = await fs.readFile(artifact)
const result = { status: 'passed', version: packageJSON.version, gitRevision: revision, file: filename, path: artifact, bytes: bytes.length, sha256: sha256(bytes), tarMembers: members.length, ...verified,
  verification: 'Final gzip tar was independently extracted; every application file matches the exact Git blob, all three upstream input SHA256/bytes and original Kokoro npm integrity match, provenance matches the committed audit; no unlisted/private state members exist.' }
await fs.writeFile(join(destination, 'corresponding-source-verification.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
