import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { createDocumentTranslator, resolveSourcePath, translationPath } from './document-translation'
import { alignTranslatedBlocks } from '../shared/translation-alignment'
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
      await fs.symlink(outside, join(root, '.review'))
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
  it('retains completed alignment and legacy checkpoint metadata after moving the full folder', async () => {
    const source = join(root, 'source.md')
    await fs.writeFile(source, '# English\n\nOrdinary prose.')
    const { translator, progress } = service()
    await translator.start(source, config(async (messages) => response(messages)))
    await complete(progress)
    expect(await translator.loadAlignment(source)).not.toBeNull()
    for (const name of await metadataFiles()) {
      const path = join(root, '.review', 'translations', name)
      const { sourceFile: _sourceFile, targetRelative: _targetRelative, ...fields } = JSON.parse(await fs.readFile(path, 'utf8'))
      await fs.writeFile(path, JSON.stringify({ ...fields, version: 1, sourcePath: source, targetPath: join(root, 'source.zh.md') }))
    }
    await moveLibrary()
    const moved = join(root, 'source.md')
    expect((await service().translator.inspect(moved)).task).toMatchObject({ phase: 'complete', sourcePath: moved, targetPath: join(root, 'source.zh.md') })
    expect(await service().translator.loadAlignment(moved)).not.toBeNull()
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
