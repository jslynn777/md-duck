import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { LearnedWord, Note } from '../shared/types'
import { isPathInsideRoot } from './allowed-path'
import { createReviewStore } from './review-store'

type Operation = { kind: 'note'; record: Note } | { kind: 'word'; record: LearnedWord }
type Snapshot = { version: number; document: string; notes: Note[]; words: LearnedWord[] }
let suite: string
let fixture: string
let library: string
let userData: string
let runner: string
const children = new Set<ChildProcess>()

beforeAll(async () => {
  suite = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'md-duck-review-process-')))
  // Bundle the production store and its real filesystem/lock/migration dependencies.
  // Each child imports this bundle into a separate Node process, with no store mocks.
  await build({
    stdin: {
      contents: "export { createReviewStore } from './review-store'; export { isPathInsideRoot } from './allowed-path';",
      resolveDir: dirname(fileURLToPath(import.meta.url)),
      loader: 'ts'
    },
    outfile: join(suite, 'review-store.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent'
  })
  runner = join(suite, 'worker.cjs')
  await fs.writeFile(runner, `
const fs = require('node:fs/promises');
const path = require('node:path');
const { createReviewStore, isPathInsideRoot } = require('./review-store.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const store = createReviewStore({
    userData: config.userData,
    isAllowed: file => isPathInsideRoot(file, config.library),
    candidates: async source => {
      const dir = path.dirname(source);
      const names = (await fs.readdir(dir)).filter(name => name.endsWith('.md') && !name.endsWith('.zh.md')).sort();
      return Promise.all(names.map(async name => ({ name, sourceText: await fs.readFile(path.join(dir, name), 'utf8') })));
    }
  });
  await fs.writeFile(config.ready + '.tmp', String(process.pid), { flag: 'wx' });
  await fs.rename(config.ready + '.tmp', config.ready);
  const deadline = Date.now() + 10000;
  while (true) {
    try { await fs.access(config.start); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (Date.now() >= deadline) throw new Error('Start barrier timed out');
    await sleep(2);
  }
  for (const operation of config.operations) {
    if (operation.kind === 'note') await store.saveNote(config.source, operation.record);
    else await store.saveWord(config.source, operation.record);
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
`)
}, 15_000)

beforeEach(async () => {
  fixture = await fs.mkdtemp(join(suite, 'case-'))
  library = join(fixture, 'library')
  userData = join(fixture, 'user-data')
  await Promise.all([fs.mkdir(library), fs.mkdir(userData)])
})

afterEach(async () => {
  await Promise.all([...children].map(async (child) => {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit')
      child.kill('SIGKILL')
      await ended
    }
  }))
  children.clear()
  await fs.rm(fixture, { recursive: true, force: true })
})
afterAll(async () => { if (suite) await fs.rm(suite, { recursive: true, force: true }) })

function note(id: string, quote = `Quote ${id}`, comment = `Comment ${id}`): Note {
  return { id, blockId: 'intro', blockKey: 'id:intro', quote, quoteLang: 'source', comment, createdAt: '2026-09-28T00:00:00.000Z', status: 'open' }
}
function word(id: string, sentence = `Sentence ${id}`, token = id): LearnedWord {
  return { id, word: token, key: token, sentence, meaning: `Meaning ${id}`, blockId: 'intro', createdAt: '2026-09-28T00:00:00.000Z' }
}
async function article(name: string, sourceText = `# ${name}\n\nArticle content.`) {
  const source = join(library, name)
  await fs.writeFile(source, sourceText)
  return source
}
function store() {
  return createReviewStore({
    userData,
    isAllowed: (path) => isPathInsideRoot(path, library),
    candidates: async (source) => {
      const dir = dirname(source)
      const names = (await fs.readdir(dir)).filter((name) => name.endsWith('.md') && !name.endsWith('.zh.md')).sort()
      return Promise.all(names.map(async (name) => ({ name, sourceText: await fs.readFile(join(dir, name), 'utf8') })))
    }
  })
}

async function runTogether(jobs: [{ source: string; operations: Operation[] }, { source: string; operations: Operation[] }]) {
  const start = join(fixture, 'start.barrier')
  const workers = await Promise.all(jobs.map(async (job, index) => {
    const configFile = join(fixture, `worker-${index}.json`)
    const ready = join(fixture, `worker-${index}.ready`)
    await fs.writeFile(configFile, JSON.stringify({ ...job, library, userData, ready, start }))
    const child = spawn(process.execPath, [runner, configFile], { stdio: ['ignore', 'pipe', 'pipe'] })
    children.add(child)
    let output = ''
    child.stdout.on('data', (data: Buffer) => { output += data.toString() })
    child.stderr.on('data', (data: Buffer) => { output += data.toString() })
    const finished = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (code === 0) resolve()
        else reject(new Error(`Review-store child ${index} exited ${code ?? signal}: ${output}`))
      })
    })
    void finished.catch(() => undefined)
    return { child, ready, finished }
  }))
  const readyPids = await Promise.all(workers.map(async (worker) => {
    const waitForReady = async () => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const value = await fs.readFile(worker.ready, 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (value !== null) return Number(value)
        await delay(5)
      }
      throw new Error('Review-store child did not reach the start barrier')
    }
    return Promise.race([
      waitForReady(),
      worker.finished.then(() => { throw new Error('Review-store child exited before its start barrier') })
    ])
  }))
  expect(new Set(readyPids).size).toBe(2)
  expect(readyPids).not.toContain(process.pid)
  expect(readyPids.every((pid) => Number.isInteger(pid) && pid > 0)).toBe(true)
  // Both stores exist and both processes are waiting. This single file releases
  // them together, before any storage transaction or migration begins.
  await fs.writeFile(start, 'go', { flag: 'wx' })
  await Promise.all(workers.map((worker) => worker.finished))
}

const sorted = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))
async function assertCommitted(source: string, notes: Note[], words: LearnedWord[]) {
  const snapshots = async (dir: string) => Promise.all((await fs.readdir(dir)).filter((name) => name.endsWith('.json')).map(async (name) => JSON.parse(await fs.readFile(join(dir, name), 'utf8')) as Snapshot))
  const primaries = (await snapshots(join(dirname(source), '.review', 'documents'))).filter((data) => data.document === basename(source))
  const backups = (await snapshots(join(userData, 'review-backups'))).filter((data) => data.document === basename(source))
  expect(primaries).toHaveLength(1)
  expect(backups).toHaveLength(1)
  // Check the child's committed backup before load() can refresh it.
  expect(backups[0]).toEqual(primaries[0])
  expect(primaries[0].version).toBe(2)
  expect(sorted(primaries[0].notes)).toEqual(sorted(notes))
  expect(sorted(primaries[0].words)).toEqual(sorted(words))
  const loaded = await store().load(source)
  expect(loaded.reviewIssue).toBeUndefined()
  expect(loaded.notesMissing).toBe(false)
  expect(sorted(loaded.notes)).toEqual(sorted(notes))
  expect(sorted(loaded.words)).toEqual(sorted(words))
  return loaded
}

describe('review store across independent Node processes', () => {
  it('keeps all notes when two processes save to the same existing article concurrently', async () => {
    const source = await article('article.md')
    const existing = note('existing')
    await store().saveNote(source, existing)
    const one = Array.from({ length: 6 }, (_, index) => note(`one-${index}`))
    const two = Array.from({ length: 6 }, (_, index) => note(`two-${index}`))
    await runTogether([
      { source, operations: one.map((record) => ({ kind: 'note', record })) },
      { source, operations: two.map((record) => ({ kind: 'note', record })) }
    ])
    await assertCommitted(source, [existing, ...one, ...two], [])
  }, 15_000)

  it('keeps both record types when one process writes notes while another writes words', async () => {
    const source = await article('article.md')
    const existingNote = note('existing-note')
    const existingWord = word('existing-word')
    await store().saveNote(source, existingNote)
    await store().saveWord(source, existingWord)
    const notes = Array.from({ length: 6 }, (_, index) => note(`note-${index}`))
    const words = Array.from({ length: 6 }, (_, index) => word(`word-${index}`))
    await runTogether([
      { source, operations: notes.map((record) => ({ kind: 'note', record })) },
      { source, operations: words.map((record) => ({ kind: 'word', record })) }
    ])
    await assertCommitted(source, [existingNote, ...notes], [existingWord, ...words])
  }, 15_000)

  it('migrates the shared legacy store once and isolates two same-folder articles on their concurrent first writes', async () => {
    const aSentence = 'The amber fox rests on the river bank.'
    const bSentence = 'The blue bird flies above the bank building.'
    const sharedSentence = 'Both articles share this sentence.'
    const a = await article('a.md', `<!-- block:intro -->\n${aSentence}\n\n${sharedSentence}`)
    const b = await article('b.md', `<!-- block:intro -->\n${bSentence}\n\n${sharedSentence}`)
    const aNote = note('legacy-a', aSentence)
    const bNote = note('legacy-b', bSentence)
    const ambiguousNote = note('ambiguous', sharedSentence)
    const aWord = word('legacy-a-word', aSentence, 'bank')
    const bWord = word('legacy-b-word', bSentence, 'bank')
    const ambiguousWord = word('ambiguous-word', sharedSentence, 'share')
    const oldDir = join(library, '.review')
    await fs.mkdir(oldDir)
    const notesRaw = JSON.stringify({ version: 1, notes: [aNote, bNote, ambiguousNote] })
    const wordsRaw = JSON.stringify({ version: 1, words: [aWord, bWord, ambiguousWord] })
    await Promise.all([
      fs.writeFile(join(oldDir, 'notes.json'), notesRaw),
      fs.writeFile(join(oldDir, 'words.json'), wordsRaw)
    ])
    expect(await fs.stat(join(oldDir, 'migration-v1.json')).catch(() => null)).toBeNull()
    expect(await fs.stat(join(oldDir, 'documents')).catch(() => null)).toBeNull()
    // Repeated block IDs and note IDs deliberately cannot establish article ownership.
    const freshA = note('fresh-note', aSentence, 'New comment on A')
    const freshB = note('fresh-note', bSentence, 'New comment on B')
    const freshAWord = word('fresh-word', aSentence, 'fox')
    const freshBWord = word('fresh-word', bSentence, 'bird')
    await runTogether([
      { source: a, operations: [{ kind: 'note', record: freshA }, { kind: 'word', record: freshAWord }] },
      { source: b, operations: [{ kind: 'note', record: freshB }, { kind: 'word', record: freshBWord }] }
    ])
    expect((await assertCommitted(a, [aNote, freshA], [aWord, freshAWord])).legacyUnassigned).toBe(2)
    expect((await assertCommitted(b, [bNote, freshB], [bWord, freshBWord])).legacyUnassigned).toBe(2)
    const plan = JSON.parse(await fs.readFile(join(oldDir, 'migration-v1.json'), 'utf8'))
    expect(plan).toEqual({
      version: 1,
      documents: { 'a.md': { notes: [aNote], words: [aWord] }, 'b.md': { notes: [bNote], words: [bWord] } },
      unassigned: { notes: [ambiguousNote], words: [ambiguousWord] }
    })
    expect(await fs.readFile(join(oldDir, 'notes.json'), 'utf8')).toBe(notesRaw)
    expect(await fs.readFile(join(oldDir, 'words.json'), 'utf8')).toBe(wordsRaw)
  }, 15_000)
})
