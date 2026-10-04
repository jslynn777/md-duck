import { describe, expect, it } from 'vitest'
import type { LearnedWord, Note } from '../shared/types'
import { planLegacyReviewMigration } from './review-migration'

function note(id: string, quote: string, patch: Partial<Note> = {}): Note {
  return { id, quote, quoteLang: 'source', blockId: 'intro', blockKey: 'id:intro', comment: `Comment ${id}`,
    createdAt: '2026-09-28T00:00:00.000Z', status: 'open', ...patch }
}

function word(id: string, sentence: string, patch: Partial<LearnedWord> = {}): LearnedWord {
  return { id, word: 'bank', key: 'bank', sentence, meaning: `Meaning ${id}`, blockId: 'intro',
    createdAt: '2026-09-28T00:00:00.000Z', ...patch }
}

describe('legacy review migration planning', () => {
  it('assigns all records to a single source article even when its content has changed', () => {
    const notes = [note('old-note', 'Deleted text', { quoteLang: 'zh', status: 'resolved' })]
    const words = [word('old-word', 'Deleted sentence')]
    const result = planLegacyReviewMigration([{ name: 'article.md', sourceText: '# Rewritten article' }], notes, words)
    expect(result).toEqual({ documents: { 'article.md': { notes, words } }, unassigned: { notes: [], words: [] } })
    expect(result.documents['article.md'].notes).not.toBe(notes)
    expect(result.documents['article.md'].words).not.toBe(words)
  })

  it('isolates notes and same-word entries from two articles sharing block IDs', () => {
    const aNote = note('a', 'I visited the bank.')
    const bNote = note('b', 'We sat on the river bank.')
    const aWord = word('a-bank', aNote.quote)
    const bWord = word('b-bank', bNote.quote)
    const result = planLegacyReviewMigration([
      { name: 'a.md', sourceText: `<!-- block:intro -->\n\n${aNote.quote}` },
      { name: 'b.md', sourceText: `<!-- block:intro -->\n\n${bNote.quote}` }
    ], [aNote, bNote], [aWord, bWord])
    expect(result.documents['a.md']).toEqual({ notes: [aNote], words: [aWord] })
    expect(result.documents['b.md']).toEqual({ notes: [bNote], words: [bWord] })
    expect(result.unassigned).toEqual({ notes: [], words: [] })
  })

  it('matches Chinese quotes only against the paired translation', () => {
    const translated = note('translated', '这是一句中文。', { quoteLang: 'zh' })
    const sourceOnly = note('source-only', '原文里出现的中文。', { quoteLang: 'zh' })
    const result = planLegacyReviewMigration([
      { name: 'a.md', sourceText: 'Original A. 原文里出现的中文。', zhText: '这是一句中文。' },
      { name: 'b.md', sourceText: '这是一句中文。', zhText: '另一份译文。' }
    ], [translated, sourceOnly], [])
    expect(result.documents['a.md'].notes).toEqual([translated])
    expect(result.documents['b.md'].notes).toEqual([])
    expect(result.unassigned.notes).toEqual([sourceOnly])
  })

  it('matches rendered Markdown text across formatting, entities, line breaks, and Unicode composition', () => {
    const quote = 'Visit the bank & café today.'
    const marked = note('formatted', quote)
    const learned = word('formatted-word', 'Visit the\tbank & café\ntoday.')
    const result = planLegacyReviewMigration([
      { name: 'a.md', sourceText: 'Visit **the** [bank](https://example.com) &amp; cafe\u0301\n today.' },
      { name: 'b.md', sourceText: 'Unrelated text.' }
    ], [marked], [learned])
    expect(result.documents['a.md']).toEqual({ notes: [marked], words: [learned] })
    expect(result.unassigned).toEqual({ notes: [], words: [] })
  })

  it('retains ambiguous and unmatched records without using a block ID to guess', () => {
    const ambiguous = note('same', 'Shared sentence.')
    const missing = note('missing', 'Deleted sentence.')
    const ambiguousWord = word('same-word', 'Shared sentence.')
    const missingWord = word('missing-word', 'Deleted sentence.')
    const result = planLegacyReviewMigration([
      { name: 'a.md', sourceText: '<!-- block:intro -->\n\nShared sentence. The bank is open.' },
      { name: 'b.md', sourceText: 'Shared sentence.' }
    ], [ambiguous, missing], [ambiguousWord, missingWord])
    expect(result.unassigned).toEqual({ notes: [ambiguous, missing], words: [ambiguousWord, missingWord] })
    expect(result.documents['a.md']).toEqual({ notes: [], words: [] })
    expect(result.documents['b.md']).toEqual({ notes: [], words: [] })
  })

  it('uses a whole word only when the saved sentence is empty and the article match is unique', () => {
    const unique = word('bank', '', { word: 'Bank' })
    const ambiguous = word('shared', '  ', { word: 'shared', key: 'shared' })
    const absent = word('absent', '', { word: 'missing', key: 'missing' })
    const result = planLegacyReviewMigration([
      { name: 'a.md', sourceText: 'The BANK is shared.' },
      { name: 'b.md', sourceText: 'Bankruptcy is a shared concern.' }
    ], [], [unique, ambiguous, absent])
    expect(result.documents['a.md'].words).toEqual([unique])
    expect(result.documents['b.md'].words).toEqual([])
    expect(result.unassigned.words).toEqual([ambiguous, absent])
  })

  it('does not treat Markdown metadata, block markers, or link destinations as visible text', () => {
    const metadata = note('metadata', 'Metadata only')
    const marker = note('marker', 'block:intro')
    const destination = word('destination', 'https://example.com/secret-bank')
    const result = planLegacyReviewMigration([
      { name: 'a.md', sourceText: '---\ntitle: Metadata only\n---\n\n<!-- block:intro -->\n\n[Visible label](https://example.com/secret-bank)' },
      { name: 'b.md', sourceText: 'Other text.' }
    ], [metadata, marker], [destination])
    expect(result.unassigned).toEqual({ notes: [metadata, marker], words: [destination] })
  })

  it('preserves every record when no source articles remain', () => {
    const notes = [note('a', 'First quote'), note('b', 'Second quote')]
    const words = [word('a', 'First sentence'), word('b', 'Second sentence')]
    expect(planLegacyReviewMigration([], notes, words)).toEqual({ documents: {}, unassigned: { notes, words } })
  })

  it('leaves blank quotes unassigned and does not mutate records or input arrays', () => {
    const blank = Object.freeze(note('blank', ' \n\t '))
    const emptyWord = Object.freeze(word('empty', '', { word: '', key: '' }))
    const notes = [blank]
    const words = [emptyWord]
    Object.freeze(notes)
    Object.freeze(words)
    const result = planLegacyReviewMigration([
      { name: 'a.md', sourceText: 'First article' },
      { name: 'b.md', sourceText: 'Second article' }
    ], notes, words)
    expect(result.unassigned).toEqual({ notes: [blank], words: [emptyWord] })
    expect(result.unassigned.notes[0]).toBe(blank)
    expect(result.unassigned.words[0]).toBe(emptyWord)
  })
})
