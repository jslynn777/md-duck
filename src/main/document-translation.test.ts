import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { createDocumentTranslator, resolveSourcePath, translationPath } from './document-translation'
import { alignTranslatedBlocks, translationContentHash } from '../shared/translation-alignment'
import { parseDocument } from '../shared/markdown'
import type { AIMessage } from '../shared/ai'
import type { TranslationState } from '../shared/translation'

let root: string
let disposers: Array<() => void>
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'md-duck-translation-test-'))); disposers = [] })
afterEach(async () => {
  disposers.forEach((dispose) => dispose())
  await fs.rm(root, { recursive: true, force: true })
})

function response(messages: AIMessage[], transform = (text: string) => `译文${text.match(/\d+/)?.[0] ?? ''}`) {
  const input = JSON.parse(messages[1].content) as { segments: Array<{ id: string; text: string }> }
  return JSON.stringify({ translations: input.segments.map(({ id, text }) => ({ id, text: transform(text) })) })
}
function service() {
  const progress: TranslationState[] = []
  const translator = createDocumentTranslator({
    onProgress: (value) => progress.push(value),
    isAllowed: async (path) => path === root || path.startsWith(root + sep)
  })
  disposers.push(translator.dispose)
  return { translator, progress }
}
const config = (request: (messages: AIMessage[], signal: AbortSignal) => Promise<string>) => ({ request, model: 'test/model', identity: 'private-test-identity' })
async function complete(progress: TranslationState[], phase: TranslationState['phase'] = 'complete') {
  await vi.waitFor(() => expect(progress.at(-1)?.phase).toBe(phase), { timeout: 5000, interval: 10 })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
async function metadataFiles() { return fs.readdir(join(root, '.review', 'translations')) }

async function alignmentFixture() {
  const source = join(root, 'inspect.md')
  const target = join(root, 'inspect.zh.md')
  const sourceText = '# Original\n\nOrdinary text.'
  const targetText = '# 标题\n\n中文段落。'
  await fs.writeFile(source, sourceText)
  await fs.writeFile(target, targetText)
  const sourceBlocks = parseDocument(sourceText, '').blocks
  const targetBlocks = parseDocument(targetText, '').blocks
  const alignment = { sourceHash: translationContentHash(sourceText), targetHash: translationContentHash(targetText),
    pairs: sourceBlocks.map((block, index) => ({ sourceKey: block.key, targetKey: targetBlocks[index].key })) }
  const record = { version: 2, sourceFile: 'inspect.md', targetRelative: 'inspect.zh.md', ...alignment }
  const key = createHash('sha256').update('inspect.md').digest('hex').slice(0, 24)
  const metadata = join(root, '.review', 'translations', `${key}.alignment.json`)
  await fs.mkdir(dirname(metadata), { recursive: true })
  await fs.writeFile(metadata, JSON.stringify(record, null, 2))
  return { source, target, sourceText, targetText, alignment, record, metadata }
}

describe('read-only alignment record inspection', () => {
  it('reports absent metadata without creating review folders or positional pairs', async () => {
    const source = join(root, 'unmarked.md')
    const target = join(root, 'unmarked.zh.md')
    await fs.writeFile(source, 'First.\n\nSecond.')
    await fs.writeFile(target, '第一。\n\n第二。')
    const { translator, progress } = service()
    expect(await translator.inspectAlignment(source)).toEqual({ alignment: null, state: 'absent' })
    expect(await translator.loadAlignment(source)).toBeNull()
    expect(await fs.readdir(root)).toEqual(expect.arrayContaining(['unmarked.md', 'unmarked.zh.md']))
    expect(await fs.stat(join(root, '.review')).catch(() => null)).toBeNull()
    expect(await fs.readFile(source, 'utf8')).toBe('First.\n\nSecond.')
    expect(await fs.readFile(target, 'utf8')).toBe('第一。\n\n第二。')
    expect(progress).toEqual([])
  })

  it('returns the existing valid map and leaves every file and record unchanged', async () => {
    const fixture = await alignmentFixture()
    const before = await fs.readFile(fixture.metadata)
    const beforeStat = await fs.stat(fixture.metadata)
    const { translator, progress } = service()
    const mutationSpies = [vi.spyOn(fs, 'writeFile'), vi.spyOn(fs, 'mkdir'), vi.spyOn(fs, 'rename'), vi.spyOn(fs, 'unlink')]
    try {
      expect(await translator.inspectAlignment(fixture.source)).toEqual({ alignment: fixture.alignment, state: 'valid' })
      expect(await translator.loadAlignment(fixture.source)).toEqual(fixture.alignment)
      mutationSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled())
    } finally { mutationSpies.forEach((spy) => spy.mockRestore()) }
    expect(await fs.readFile(fixture.metadata)).toEqual(before)
    expect((await fs.stat(fixture.metadata)).mtimeMs).toBe(beforeStat.mtimeMs)
    expect(await fs.readFile(fixture.source, 'utf8')).toBe(fixture.sourceText)
    expect(await fs.readFile(fixture.target, 'utf8')).toBe(fixture.targetText)
    expect(await metadataFiles()).toHaveLength(1)
    expect(progress).toEqual([])
  })

  it.each(['source', 'target'] as const)('reports stale content after a %s edit without repairing the record', async (side) => {
    const fixture = await alignmentFixture()
    const before = await fs.readFile(fixture.metadata)
    await fs.appendFile(fixture[side], '\n\nChanged content.')
    const { translator } = service()
    expect(await translator.inspectAlignment(fixture.source)).toEqual({ alignment: null, state: 'stale' })
    expect(await translator.loadAlignment(fixture.source)).toBeNull()
    expect(await fs.readFile(fixture.metadata)).toEqual(before)
    expect(await fs.readFile(fixture[side], 'utf8')).toContain('Changed content.')
    expect(await metadataFiles()).toHaveLength(1)
  })

  it.each(['malformed', 'array', 'missing-fields', 'bad-pair', 'wrong-target'] as const)(
    'reports an unusable %s record and preserves its bytes', async (kind) => {
      const fixture = await alignmentFixture()
      const records = { malformed: '{', array: '[]', 'missing-fields': JSON.stringify({ version: 2 }),
        'bad-pair': JSON.stringify({ ...fixture.record, pairs: [{ sourceKey: 42, targetKey: 'x' }] }),
        'wrong-target': JSON.stringify({ ...fixture.record, targetRelative: 'different.md' }) }
      await fs.writeFile(fixture.metadata, records[kind])
      const { translator } = service()
      expect(await translator.inspectAlignment(fixture.source)).toEqual({ alignment: null, state: 'invalid' })
      expect(await translator.loadAlignment(fixture.source)).toBeNull()
      expect(await fs.readFile(fixture.metadata, 'utf8')).toBe(records[kind])
      expect(await fs.readFile(fixture.source, 'utf8')).toBe(fixture.sourceText)
      expect(await fs.readFile(fixture.target, 'utf8')).toBe(fixture.targetText)
    })

  it('reports inaccessible record contents as invalid rather than absent', async () => {
    const fixture = await alignmentFixture()
    const readFile = fs.readFile.bind(fs)
    const read = vi.spyOn(fs, 'readFile').mockImplementation((file, options) => {
      if (String(file) === fixture.metadata) return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      return readFile(file, options)
    })
    try {
      expect(await service().translator.inspectAlignment(fixture.source)).toEqual({ alignment: null, state: 'invalid' })
    } finally { read.mockRestore() }
    expect(await fs.readFile(fixture.metadata, 'utf8')).toBe(JSON.stringify(fixture.record, null, 2))
  })

  it('reports a missing referenced document as unusable while preserving the sidecar', async () => {
    const fixture = await alignmentFixture()
    const before = await fs.readFile(fixture.metadata)
    await fs.unlink(fixture.target)
    expect(await service().translator.inspectAlignment(fixture.source)).toEqual({ alignment: null, state: 'invalid' })
    expect(await fs.readFile(fixture.metadata)).toEqual(before)
    expect(await fs.stat(fixture.target).catch(() => null)).toBeNull()
  })

  it('passes hash-valid maps to the existing structural reader for independent key validation', async () => {
    const fixture = await alignmentFixture()
    const pair = { sourceKey: 'unknown-source', targetKey: 'unknown-target' }
    await fs.writeFile(fixture.metadata, JSON.stringify({ ...fixture.record, pairs: [pair] }))
    const inspected = await service().translator.inspectAlignment(fixture.source)
    expect(inspected).toEqual({ alignment: { ...fixture.alignment, pairs: [pair] }, state: 'valid' })
    expect(alignTranslatedBlocks(parseDocument(fixture.sourceText, '').blocks, parseDocument(fixture.targetText, '').blocks,
      fixture.sourceText, fixture.targetText, inspected.alignment).independent).toBe(true)
  })

  it('keeps allowed-root and metadata symlink authorization ahead of any content read', async () => {
    const outside = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'md-duck-inspection-outside-')))
    try {
      const source = join(root, 'safe.md')
      await fs.writeFile(source, '# Safe')
      await fs.symlink(outside, join(root, '.review'), 'dir')
      const { translator } = service()
      const read = vi.spyOn(fs, 'readFile')
      try {
        await expect(translator.inspectAlignment(source)).rejects.toThrow('ERR_NOT_IN_FOLDER')
        await expect(translator.inspectAlignment(join(outside, 'outside.md'))).rejects.toThrow('ERR_NOT_IN_FOLDER')
        expect(read).not.toHaveBeenCalled()
      } finally { read.mockRestore() }
    } finally { await fs.rm(outside, { recursive: true, force: true }) }
  })
})

describe('document translation pairing', () => {
  it('pairs arbitrary Markdown names, preserving extensions and standalone Chinese files', async () => {
    expect(translationPath('/docs/notes.md')).toBe('/docs/notes.zh.md')
    expect(translationPath('/docs/Notes.MARKDOWN')).toBe('/docs/Notes.zh.MARKDOWN')
    expect(translationPath('/docs/data.txt')).toBeNull()
    const translated = join(root, 'notes.zh.md')
    await fs.writeFile(translated, '# 中文')
    expect(await resolveSourcePath(translated)).toBe(translated)
    await fs.writeFile(join(root, 'notes.md'), '# Notes')
    expect(await resolveSourcePath(translated)).toBe(join(root, 'notes.md'))
  })

  it('does not offer translation for empty/code-only or predominantly Chinese prose', async () => {
    const { translator } = service()
    const empty = join(root, 'empty.md')
    await fs.writeFile(empty, '---\ntitle: Empty\n---\n\n```js\nconsole.log("Hello")\n```')
    expect(await translator.inspect(empty)).toMatchObject({ canTranslate: false, reason: 'empty' })
    const chinese = join(root, '中文.md')
    await fs.writeFile(chinese, '# 这是中文文章\n\n已经有完整的中文内容，不需要再次翻译。')
    expect(await translator.inspect(chinese)).toMatchObject({ canTranslate: false, reason: 'chinese' })
  })

  it('protects an existing empty translation and never treats it as available bilingual content', async () => {
    const { translator } = service()
    const source = join(root, 'notes.md')
    const target = join(root, 'notes.zh.md')
    await fs.writeFile(source, '# Hello')
    await fs.writeFile(target, '  \n')
    expect(await translator.inspect(source)).toMatchObject({ canTranslate: false, hasTranslation: false, reason: 'target-exists' })
    const request = vi.fn(async (messages: AIMessage[]) => response(messages))
    await expect(translator.start(source, config(request))).rejects.toThrow('ERR_TRANSLATION_TARGET_EXISTS')
    expect(await fs.readFile(target, 'utf8')).toBe('  \n')
    expect(request).not.toHaveBeenCalled()
  })

  it('associates an existing file without copying it or inventing positional correspondence', async () => {
    const { translator } = service()
    const source = join(root, 'draft.md')
    const target = join(root, '手工译文.md')
    await fs.writeFile(source, '# English\n\nOne paragraph.')
    await fs.writeFile(target, '# 中文\n\n手工翻译内容。')
    expect(await translator.associate(source, target)).toMatchObject({ hasTranslation: true, targetPath: target })
    expect(await translator.getTargetPath(source)).toBe(target)
    expect(await translator.loadAlignment(source)).toBeNull()
    expect(await fs.readFile(target, 'utf8')).toBe('# 中文\n\n手工翻译内容。')
    expect(await fs.stat(join(root, 'draft.zh.md')).catch(() => null)).toBeNull()
  })
})

describe('structured Markdown translation', () => {
  it('preserves source, YAML, URLs, code, tables, nested lists, quotes and original block IDs', async () => {
    const input = `---
title: Original English title
description: Keep metadata exactly
---

<!-- block:intro -->
# Hello **world**

Read [the documentation](https://example.com/docs?q=1 "Original title") and use \`npm install\`.
Visit https://example.com/automatic or <https://example.com/angle>.
Read [reference label][guide], [guide][] or [guide].

[guide]: https://example.com/reference "Original reference title"

![Image label](./assets/photo.png "Keep image title")

- [x] Completed task
- First list item
  - Nested list item
    continues here

> First quoted line
> continues here
>
> Another quoted paragraph

| Product | Price |
| :--- | ---: |
| Ribbon | 12 |

\`\`\`js
console.log('Do not translate code')
\`\`\`

<!-- keep this exact comment -->
`;
    const source = join(root, 'reader.markdown')
    await fs.writeFile(source, input)
    const { translator, progress } = service()
    const request = vi.fn(async (messages: AIMessage[]) => response(messages))
    expect(await translator.start(source, config(request))).toMatchObject({ phase: 'running' })
    await complete(progress)
    const output = await fs.readFile(join(root, 'reader.zh.markdown'), 'utf8')
    expect(await fs.readFile(source, 'utf8')).toBe(input)
    expect(output).toContain('title: Original English title')
    expect(output).toContain('<!-- block:intro -->')
    expect(output).toContain('https://example.com/docs?q=1 "Original title"')
    expect(output).toContain('https://example.com/automatic')
    expect(output).toContain('<https://example.com/angle>')
    expect(output).toContain('[译文][guide]')
    expect(output).toContain('[guide][]')
    expect(output).toContain('[guide]: https://example.com/reference "Original reference title"')
    expect(output).toContain('![Image label](./assets/photo.png "Keep image title")')
    expect(output).toContain('`npm install`')
    expect(output).toContain("console.log('Do not translate code')")
    expect(output).toContain('| :--- | ---: |')
    expect(output).toContain('> 译文\n> 译文')
    expect(output).toContain('  - 译文\n    译文')
    const alignment = await translator.loadAlignment(source)
    expect(alignment).not.toBeNull()
    const sourceBlocks = parseDocument(input, '').blocks
    const translatedBlocks = parseDocument(output, '').blocks
    const paired = alignTranslatedBlocks(sourceBlocks, translatedBlocks, input, output, alignment)
    expect(paired.independent).toBe(false)
    expect(paired.rows).toHaveLength(sourceBlocks.length)
    expect(paired.rows[0].source).toBe(sourceBlocks[0])
    expect(sourceBlocks.filter((block) => block.id)).toHaveLength(1)
    expect(paired.rows.filter((row) => row.source?.kind === 'listItem')).toHaveLength(2)
    const files = await metadataFiles()
    const draftText = await fs.readFile(join(root, '.review', 'translations', files.find((file) => file.endsWith('.draft.json'))!), 'utf8')
    expect(draftText).not.toContain('private-test-identity')
  })

  it('escapes model punctuation rather than allowing it to introduce Markdown links or executable HTML', async () => {
    const source = join(root, 'safe.md')
    await fs.writeFile(source, '# Heading\n\nOrdinary prose.')
    const { translator, progress } = service()
    await translator.start(source, config(async (messages) => response(messages, () => '译文 [链接](位置) <script>alert(1)</script> **粗体**')))
    await vi.waitFor(() => expect(progress.at(-1)?.phase).not.toBe('running'))
    expect(progress.at(-1)).toMatchObject({ phase: 'complete' })
    const output = await fs.readFile(join(root, 'safe.zh.md'), 'utf8')
    const blocks = parseDocument(output, '').blocks
    expect(blocks).toHaveLength(2)
    expect(blocks[1].inlines?.every((inline) => inline.type === 'text')).toBe(true)
  })

  it('rejects model-generated autolinks that would change the Markdown structure', async () => {
    const source = join(root, 'autolink.md')
    await fs.writeFile(source, '# Ordinary heading')
    const { translator, progress } = service()
    await translator.start(source, config(async (messages) => response(messages, () => '译文 https://unexpected.example')))
    await complete(progress, 'failed')
    expect(progress.at(-1)?.error).toBe('ERR_TRANSLATION_STRUCTURE')
    expect(await fs.stat(join(root, 'autolink.zh.md')).catch(() => null)).toBeNull()
  })

  it.each([
    () => 'not json',
    () => '{"translations":[]}',
    () => '{"translations":[{"id":"wrong","text":"译文"}]}',
    () => '{"translations":[{"id":"s0","text":"译文\\n新段落"}]}',
  ])('does not publish an invalid model response', async (invalid) => {
    const source = join(root, 'invalid.md')
    await fs.writeFile(source, '# Original heading')
    const { translator, progress } = service()
    await translator.start(source, config(async () => invalid()))
    await complete(progress, 'failed')
    expect(progress.at(-1)?.error).toBe('ERR_TRANSLATION_BAD_RESPONSE')
    expect(await fs.stat(join(root, 'invalid.zh.md')).catch(() => null)).toBeNull()
  })
})

describe('translation checkpoint and conflicts', () => {
  it('stops promptly even if the provider ignores abort, restores checkpoints after restart, and ignores late results', async () => {
    const source = join(root, 'resume.md')
    await fs.writeFile(source, '# Heading\n\nFirst paragraph.\n\nSecond paragraph.')
    const pending = deferred<string>()
    let pendingMessages: AIMessage[] = []
    const first = service()
    const firstRequest = vi.fn(async (messages: AIMessage[]) => {
      if (firstRequest.mock.calls.length === 1) return response(messages)
      pendingMessages = messages
      return pending.promise
    })
    await first.translator.start(source, config(firstRequest))
    await vi.waitFor(() => expect(firstRequest).toHaveBeenCalledTimes(2))
    expect(await first.translator.stop(source)).toMatchObject({ phase: 'paused', completed: 1, total: 3 })
    expect(await fs.stat(join(root, 'resume.zh.md')).catch(() => null)).toBeNull()
    const second = service()
    expect((await second.translator.inspect(source)).task).toMatchObject({ phase: 'paused', completed: 1 })
    const nextRequest = vi.fn(async (messages: AIMessage[]) => response(messages))
    await second.translator.start(source, config(nextRequest))
    await complete(second.progress)
    expect(nextRequest).toHaveBeenCalledTimes(2)
    const before = await fs.readFile(join(root, 'resume.zh.md'), 'utf8')
    pending.resolve(response(pendingMessages, () => '不应保存的旧响应'))
    await Promise.resolve()
    expect(await fs.readFile(join(root, 'resume.zh.md'), 'utf8')).toBe(before)
  })

  it('detects a changed original before saving a response, then starts a fresh version on explicit retry', async () => {
    const source = join(root, 'changed.md')
    await fs.writeFile(source, '# Old title')
    const pending = deferred<string>()
    let messages: AIMessage[] = []
    const { translator, progress } = service()
    const request = vi.fn(async (input: AIMessage[]) => { messages = input; return pending.promise })
    await translator.start(source, config(request))
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    await fs.writeFile(source, '# New title')
    pending.resolve(response(messages))
    await complete(progress, 'stale')
    expect(await fs.stat(join(root, 'changed.zh.md')).catch(() => null)).toBeNull()
    expect(await fs.readFile(source, 'utf8')).toBe('# New title')
    const next = vi.fn(async (input: AIMessage[]) => response(input, () => '新标题'))
    await translator.start(source, config(next))
    await complete(progress)
    expect(next.mock.calls[0][0][1].content).toContain('New title')
    expect(await fs.readFile(join(root, 'changed.zh.md'), 'utf8')).toBe('# 新标题')
  })

  it('restarts completed checkpoints when the selected service or model changes', async () => {
    const source = join(root, 'model.md')
    await fs.writeFile(source, '# Heading\n\nFirst paragraph.\n\nSecond paragraph.')
    const pending = deferred<string>()
    const { translator, progress } = service()
    const first = vi.fn(async (messages: AIMessage[]) => first.mock.calls.length === 1 ? response(messages, () => '旧模型译文') : pending.promise)
    await translator.start(source, config(first))
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(2))
    await translator.stop(source)
    const next = vi.fn(async (messages: AIMessage[]) => response(messages, () => '新模型译文'))
    await translator.start(source, { request: next, model: 'different-model', identity: 'different-service' })
    await complete(progress)
    expect(next).toHaveBeenCalledTimes(3)
    expect(await fs.readFile(join(root, 'model.zh.md'), 'utf8')).not.toContain('旧模型')
    pending.resolve('{}')
  })

  it('does not overwrite a target created while translation is in progress', async () => {
    const source = join(root, 'conflict.md')
    const target = join(root, 'conflict.zh.md')
    await fs.writeFile(source, '# Original')
    const pending = deferred<string>()
    let messages: AIMessage[] = []
    const { translator, progress } = service()
    const request = vi.fn(async (input: AIMessage[]) => { messages = input; return pending.promise })
    await translator.start(source, config(request))
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    await fs.writeFile(target, '# User translation')
    pending.resolve(response(messages))
    await complete(progress, 'failed')
    expect(progress.at(-1)?.error).toBe('ERR_TRANSLATION_TARGET_EXISTS')
    expect(await fs.readFile(target, 'utf8')).toBe('# User translation')
  })

  it('publishes atomically without overwriting a file that appears at the final filesystem operation', async () => {
    const source = join(root, 'atomic.md')
    const target = join(root, 'atomic.zh.md')
    await fs.writeFile(source, '# Original')
    const link = fs.link.bind(fs)
    const collision = vi.spyOn(fs, 'link').mockImplementationOnce(async (oldPath, newPath) => {
      await fs.writeFile(newPath, 'User file created at commit time')
      return link(oldPath, newPath)
    })
    try {
      const { translator, progress } = service()
      await translator.start(source, config(async (messages) => response(messages)))
      await complete(progress, 'failed')
      expect(progress.at(-1)?.error).toBe('ERR_TRANSLATION_TARGET_EXISTS')
      expect(await fs.readFile(target, 'utf8')).toBe('User file created at commit time')
      expect(await translator.loadAlignment(source)).toBeNull()
    } finally { collision.mockRestore() }
  })

  it('isolates parallel tasks and checkpoints for files in the same folder', async () => {
    const sourceA = join(root, 'first.md')
    const sourceB = join(root, 'second.md')
    await fs.writeFile(sourceA, '# First')
    await fs.writeFile(sourceB, '# Second')
    const { translator, progress } = service()
    await Promise.all([
      translator.start(sourceA, config(async (messages) => response(messages, () => '第一篇'))),
      translator.start(sourceB, config(async (messages) => response(messages, () => '第二篇')))
    ])
    await vi.waitFor(() => expect(progress.filter((item) => item.phase === 'complete')).toHaveLength(2))
    expect(await fs.readFile(join(root, 'first.zh.md'), 'utf8')).toBe('# 第一篇')
    expect(await fs.readFile(join(root, 'second.zh.md'), 'utf8')).toBe('# 第二篇')
    expect((await metadataFiles()).filter((file) => file.endsWith('.draft.json'))).toHaveLength(2)
  })

  it('invalidates correspondence when either source or translation is edited', async () => {
    const source = join(root, 'versions.md')
    const target = join(root, 'versions.zh.md')
    const original = '# Original\n\nSome text.'
    await fs.writeFile(source, original)
    const { translator, progress } = service()
    await translator.start(source, config(async (messages) => response(messages)))
    await complete(progress)
    const translated = await fs.readFile(target, 'utf8')
    expect(await translator.loadAlignment(source)).not.toBeNull()
    await fs.appendFile(source, '\n\nNew paragraph.')
    expect(await translator.loadAlignment(source)).toBeNull()
    await fs.writeFile(source, original)
    await fs.writeFile(target, translated + '\n\n译文中新增一段。')
    expect(await translator.loadAlignment(source)).toBeNull()
  })

  it('treats a persisted running task as paused after process restart', async () => {
    const source = join(root, 'crash.md')
    await fs.writeFile(source, '# Heading\n\nParagraph.')
    const pending = deferred<string>()
    const first = service()
    const request = vi.fn(async () => pending.promise)
    await first.translator.start(source, config(request))
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    const restarted = service()
    expect((await restarted.translator.inspect(source)).task?.phase).toBe('paused')
    await first.translator.stop(source)
    pending.resolve('{}')
  })
})

describe('translation path authorization', () => {
  it('ignores a portable association escaping the current library', async () => {
    const source = join(root, 'safe.md')
    const target = join(root, 'manual.md')
    await fs.writeFile(source, '# Source')
    await fs.writeFile(target, '# 译文')
    const { translator } = service()
    await translator.associate(source, target)
    const association = (await metadataFiles()).find((file) => file.endsWith('.association.json'))!
    await fs.writeFile(join(root, '.review', 'translations', association), JSON.stringify({
      version: 2, sourceFile: 'safe.md', targetRelative: '../../outside.md'
    }))
    expect(await translator.getTargetPath(source)).toBe(join(root, 'safe.zh.md'))
    expect(await translator.inspect(source)).toMatchObject({ hasTranslation: false, task: null })
  })
  it('ignores a tampered association pointing outside the library and uses the safe default path', async () => {
    const source = join(root, 'safe.md')
    const selected = join(root, 'manual.md')
    await fs.writeFile(source, '# Source')
    await fs.writeFile(selected, '# 手工译文')
    const { translator } = service()
    await translator.associate(source, selected)
    const association = (await metadataFiles()).find((file) => file.endsWith('.association.json'))!
    await fs.writeFile(join(root, '.review', 'translations', association), JSON.stringify({
      version: 1, sourcePath: source, targetPath: '/private/not-in-library.md'
    }))
    expect(await translator.getTargetPath(source)).toBe(join(root, 'safe.zh.md'))
    expect(await translator.inspect(source)).toMatchObject({ canTranslate: true, hasTranslation: false })
  })

  it('rejects an associated file outside the allowed folder or reached through a symlink', async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), 'md-duck-outside-test-'))
    try {
      const source = join(root, 'safe.md')
      const target = join(outside, 'external.md')
      await fs.writeFile(source, '# Source')
      await fs.writeFile(target, '# 外部文件')
      await fs.symlink(target, join(root, 'alias.md'))
      const { translator } = service()
      await expect(translator.associate(source, target)).rejects.toThrow('ERR_NOT_IN_FOLDER')
      await expect(translator.associate(source, join(root, 'alias.md'))).rejects.toThrow('ERR_NOT_IN_FOLDER')
      await fs.symlink(target, join(root, 'safe.zh.md'))
      await expect(translator.getTargetPath(source)).rejects.toThrow('ERR_NOT_IN_FOLDER')
      await fs.unlink(join(root, 'safe.zh.md'))
      await fs.symlink(outside, join(root, '.review'), 'dir')
      await expect(translator.inspect(source)).rejects.toThrow('ERR_NOT_IN_FOLDER')
    } finally { await fs.rm(outside, { recursive: true, force: true }) }
  })
})

describe('translation metadata moves with the library', () => {
  async function moveLibrary() {
    const next = `${root}-moved`
    await fs.rename(root, next)
    root = next
  }
  it('stores a portable association and resolves cross-directory translations after the complete library moves', async () => {
    const source = join(root, 'english', 'source.md')
    const target = join(root, 'chinese', 'translated.md')
    await fs.mkdir(dirname(source))
    await fs.mkdir(dirname(target))
    await fs.writeFile(source, '# English')
    await fs.writeFile(target, '# 中文')
    const { translator } = service()
    await translator.associate(source, target)
    const metaDir = join(dirname(source), '.review', 'translations')
    const association = (await fs.readdir(metaDir)).find((file) => file.endsWith('.association.json'))!
    const saved = JSON.parse(await fs.readFile(join(metaDir, association), 'utf8'))
    expect(saved).toEqual({ version: 2, sourceFile: 'source.md', targetRelative: '../chinese/translated.md' })
    await moveLibrary()
    expect(await service().translator.inspect(join(root, 'english', 'source.md'))).toMatchObject({
      hasTranslation: true, targetPath: join(root, 'chinese', 'translated.md')
    })
  })
  it.each([
    { version: 2, sourceFile: 'source.md', targetRelative: '..\\chinese\\translated.md' },
    { version: 1, sourcePath: 'C:\\old-library\\english\\source.md', targetPath: 'C:\\old-library\\chinese\\translated.md' },
    { version: 1, sourcePath: '\\\\server\\share\\old-library\\english\\source.md', targetPath: '\\\\server\\share\\old-library\\chinese\\translated.md' }
  ])('reads a Windows-origin cross-directory association after the library moves: %j', async (legacy) => {
    const source = join(root, 'english', 'source.md')
    const target = join(root, 'chinese', 'translated.md')
    await fs.mkdir(dirname(source))
    await fs.mkdir(dirname(target))
    await fs.writeFile(source, '# English')
    await fs.writeFile(target, '# 中文')
    await service().translator.associate(source, target)
    const metaDir = join(dirname(source), '.review', 'translations')
    const association = (await fs.readdir(metaDir)).find((file) => file.endsWith('.association.json'))!
    await fs.writeFile(join(metaDir, association), JSON.stringify(legacy))
    await moveLibrary()
    expect(await service().translator.inspect(join(root, 'english', 'source.md'))).toMatchObject({
      hasTranslation: true, targetPath: join(root, 'chinese', 'translated.md')
    })
  })

  it.each([
    { version: 2, sourceFile: 'source.md', targetRelative: '..\\..\\outside.md' },
    { version: 2, sourceFile: 'source.md', targetRelative: 'C:\\private\\outside.md' },
    { version: 2, sourceFile: 'source.md', targetRelative: 'C:outside.md' },
    { version: 2, sourceFile: 'source.md', targetRelative: '\\\\server\\share\\outside.md' },
    { version: 2, sourceFile: 'source.md', targetRelative: '\\private\\outside.md' },
    { version: 1, sourcePath: 'C:\\old-library\\source.md', targetPath: 'D:\\other-library\\outside.md' },
    { version: 1, sourcePath: 'C:\\old-library\\source.md', targetPath: '\\\\server\\share\\outside.md' },
    { version: 1, sourcePath: 'C:\\old-library\\source.md', targetPath: '\\private\\outside.md' }
  ])('ignores Windows-origin metadata that is not an authorized relative library path: %j', async (invalid) => {
    const source = join(root, 'source.md')
    const target = join(root, 'manual.md')
    await fs.writeFile(source, '# English')
    await fs.writeFile(target, '# 中文')
    await service().translator.associate(source, target)
    const association = (await metadataFiles()).find((file) => file.endsWith('.association.json'))!
    await fs.writeFile(join(root, '.review', 'translations', association), JSON.stringify(invalid))
    expect(await service().translator.inspect(source)).toMatchObject({
      hasTranslation: false, canTranslate: true, targetPath: join(root, 'source.zh.md')
    })
  })
  it('keeps a legacy absolute association working after a whole-folder move', async () => {
    const source = join(root, 'source.md')
    const target = join(root, 'manual.md')
    await fs.writeFile(source, '# English')
    await fs.writeFile(target, '# 中文')
    const { translator } = service()
    await translator.associate(source, target)
    const association = (await metadataFiles()).find((file) => file.endsWith('.association.json'))!
    await fs.writeFile(join(root, '.review', 'translations', association), JSON.stringify({ version: 1, sourcePath: source, targetPath: target }))
    await moveLibrary()
    expect(await service().translator.inspect(join(root, 'source.md'))).toMatchObject({ hasTranslation: true, targetPath: join(root, 'manual.md') })
  })
  it.each(['native', 'Windows'] as const)('retains completed alignment and %s legacy checkpoint metadata after moving the full folder', async (origin) => {
    const source = join(root, 'source.md')
    await fs.writeFile(source, '# English\n\nOrdinary prose.')
    const { translator, progress } = service()
    await translator.start(source, config(async (messages) => response(messages)))
    await complete(progress)
    expect(await translator.loadAlignment(source)).not.toBeNull()
    for (const name of await metadataFiles()) {
      const path = join(root, '.review', 'translations', name)
      const { sourceFile: _sourceFile, targetRelative: _targetRelative, ...fields } = JSON.parse(await fs.readFile(path, 'utf8'))
      await fs.writeFile(path, JSON.stringify({ ...fields, version: 1,
        sourcePath: origin === 'Windows' ? 'C:\\old-library\\source.md' : source,
        targetPath: origin === 'Windows' ? 'C:\\old-library\\source.zh.md' : join(root, 'source.zh.md') }))
    }
    await moveLibrary()
    const moved = join(root, 'source.md')
    expect((await service().translator.inspect(moved)).task).toMatchObject({ phase: 'complete', sourcePath: moved, targetPath: join(root, 'source.zh.md') })
    expect(await service().translator.loadAlignment(moved)).not.toBeNull()
  })
  it('retains a completed Windows v2 alignment across directories after moving the library', async () => {
    const source = join(root, 'english', 'source.md')
    const target = join(root, 'chinese', 'translated.md')
    await fs.mkdir(dirname(source))
    await fs.mkdir(dirname(target))
    await fs.writeFile(source, '# English\n\nOrdinary prose.')
    const first = service()
    await first.translator.start(source, config(async (messages) => response(messages)))
    await complete(first.progress)
    await fs.rename(join(dirname(source), 'source.zh.md'), target)
    const metaDir = join(dirname(source), '.review', 'translations')
    const paths = { version: 2, sourceFile: 'source.md', targetRelative: '..\\chinese\\translated.md' }
    const files = await fs.readdir(metaDir)
    for (const name of files) {
      const metadata = JSON.parse(await fs.readFile(join(metaDir, name), 'utf8'))
      await fs.writeFile(join(metaDir, name), JSON.stringify({ ...metadata, ...paths }))
    }
    await fs.writeFile(join(metaDir, files.find((name) => name.endsWith('.draft.json'))!.replace('.draft.json', '.association.json')), JSON.stringify(paths))
    await moveLibrary()
    const moved = join(root, 'english', 'source.md')
    const second = service()
    expect(await second.translator.inspect(moved)).toMatchObject({
      hasTranslation: true, targetPath: join(root, 'chinese', 'translated.md'), task: { phase: 'complete' }
    })
    expect(await second.translator.loadAlignment(moved)).not.toBeNull()
  })
  it('resumes a Windows-origin paused checkpoint for a sibling directory after moving and rewrites portable metadata with slashes', async () => {
    const source = join(root, 'english', 'resume.md')
    await fs.mkdir(dirname(source))
    await fs.mkdir(join(root, 'chinese'))
    await fs.writeFile(source, '# Heading\n\nFirst paragraph.\n\nSecond paragraph.')
    const pending = deferred<string>()
    const first = service()
    const firstRequest = vi.fn(async (messages: AIMessage[]) => firstRequest.mock.calls.length === 1 ? response(messages) : pending.promise)
    await first.translator.start(source, config(firstRequest))
    await vi.waitFor(() => expect(firstRequest).toHaveBeenCalledTimes(2))
    expect(await first.translator.stop(source)).toMatchObject({ phase: 'paused', completed: 1 })
    const metaDir = join(dirname(source), '.review', 'translations')
    const draftFile = (await fs.readdir(metaDir)).find((file) => file.endsWith('.draft.json'))!
    const draft = JSON.parse(await fs.readFile(join(metaDir, draftFile), 'utf8'))
    const paths = { version: 2, sourceFile: 'resume.md', targetRelative: '..\\chinese\\resume.md' }
    await fs.writeFile(join(metaDir, draftFile), JSON.stringify({ ...draft, ...paths }))
    await fs.writeFile(join(metaDir, draftFile.replace('.draft.json', '.association.json')), JSON.stringify(paths))
    await moveLibrary()
    const moved = join(root, 'english', 'resume.md')
    const second = service()
    expect((await second.translator.inspect(moved)).task).toMatchObject({
      phase: 'paused', completed: 1, sourcePath: moved, targetPath: join(root, 'chinese', 'resume.md')
    })
    const request = vi.fn(async (messages: AIMessage[]) => response(messages))
    await second.translator.start(moved, config(request))
    await complete(second.progress)
    expect(request).toHaveBeenCalledTimes(2)
    expect(await second.translator.loadAlignment(moved)).not.toBeNull()
    const movedMeta = join(dirname(moved), '.review', 'translations')
    for (const name of (await fs.readdir(movedMeta)).filter((name) => !name.endsWith('.association.json'))) {
      expect(JSON.parse(await fs.readFile(join(movedMeta, name), 'utf8'))).toMatchObject({
        version: 2, sourceFile: 'resume.md', targetRelative: '../chinese/resume.md'
      })
    }
    pending.resolve('{}')
  })
  it('resumes a portable paused checkpoint after a move without repeating completed requests', async () => {
    const source = join(root, 'resume.md')
    await fs.writeFile(source, '# Heading\n\nFirst paragraph.\n\nSecond paragraph.')
    const pending = deferred<string>()
    const first = service()
    const firstRequest = vi.fn(async (messages: AIMessage[]) => firstRequest.mock.calls.length === 1 ? response(messages) : pending.promise)
    await first.translator.start(source, config(firstRequest))
    await vi.waitFor(() => expect(firstRequest).toHaveBeenCalledTimes(2))
    expect(await first.translator.stop(source)).toMatchObject({ phase: 'paused', completed: 1 })
    await moveLibrary()
    const second = service()
    const moved = join(root, 'resume.md')
    expect((await second.translator.inspect(moved)).task).toMatchObject({ phase: 'paused', completed: 1, sourcePath: moved })
    const request = vi.fn(async (messages: AIMessage[]) => response(messages))
    await second.translator.start(moved, config(request))
    await complete(second.progress)
    expect(request).toHaveBeenCalledTimes(2)
    expect(await second.translator.loadAlignment(moved)).not.toBeNull()
    pending.resolve('{}')
  })
})
