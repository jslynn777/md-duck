#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const engine = join(root, 'src/main/kokoro-runtime-phonemizer')
const voices = join(root, 'src/main/data/kokoro-voices')
const source = JSON.parse(await fs.readFile(join(engine, 'SOURCE.json'), 'utf8'))
const styles = JSON.parse(await fs.readFile(join(voices, 'SOURCE.json'), 'utf8'))
for (const [directory, entries] of [[engine, source.outputs], [voices, styles.files]]) {
  for (const file of entries) {
    assert(!file.file.includes('..') && !file.file.startsWith('/') && !file.file.includes('\\'))
    const path = join(directory, file.file)
    assert((await fs.lstat(path)).isFile())
    const bytes = await fs.readFile(path)
    assert.equal(bytes.length, file.bytes, `Neural resource size differs: ${file.file}`)
    assert.equal(digest(bytes), file.sha256, `Neural resource hash differs: ${file.file}`)
  }
}
assert(source.emscripten.container.includes('@sha256:'))
assert.equal(source.sourceCommit, '4f6d246c1d3acf67a4d814e20da02fa3967bc92d')
assert.equal(styles.files.length, 5)
const lock = JSON.parse(await fs.readFile(join(root, 'package-lock.json'), 'utf8'))
const forbidden = ['sharp', 'phonemizer', 'guid-typescript', 'onnxruntime-web', 'kokoro-js', '@huggingface/transformers']
for (const [location, pkg] of Object.entries(lock.packages)) {
  if (!location || pkg.dev) continue
  assert(!forbidden.some((name) => location.endsWith(`/node_modules/${name}`) || location === `node_modules/${name}`), `Retired dependency remains in production: ${location}`)
}
const archiveArgument = process.argv.indexOf('--archives')
if (archiveArgument >= 0) {
  const directory = resolve(process.argv[archiveArgument + 1])
  for (const archive of [source.sourceArchive, source.emscripten.sourceArchive]) {
    const bytes = await fs.readFile(join(directory, archive.file))
    assert.equal(bytes.length, archive.bytes)
    assert.equal(digest(bytes), archive.sha256, `Source archive hash differs: ${archive.file}`)
  }
}
console.log(JSON.stringify({ status: 'passed', engineSource: source.sourceCommit, engineAndRuntimeNoticeFiles: source.outputs.length - 2, exactVoices: styles.files.length, retiredDependencies: 'absent from production lock', sourceArchives: archiveArgument >= 0 ? 'verified' : 'verify at source-bundle assembly' }, null, 2))
