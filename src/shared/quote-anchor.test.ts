import { describe, expect, it } from 'vitest'
import { makeQuoteAnchor, normalizeQuoteText, quoteRanges, resolveQuoteRange, validQuoteAnchor } from './quote-anchor'

describe('precise quote anchors', () => {
  it('locates the selected second occurrence instead of the first identical word', () => {
    const text = 'The bank is near the river bank.'
    const start = text.lastIndexOf('bank')
    const anchor = makeQuoteAnchor(text, start, start + 4)
    expect(resolveQuoteRange(text, 'bank', anchor)).toEqual({ start, end: start + 4 })
    expect(resolveQuoteRange(text, 'bank')).toBeNull()
  })

  it('follows the same occurrence when text is inserted before it', () => {
    const text = 'The bank approved the loan. We sat on the bank beside the river.'
    const start = text.lastIndexOf('bank')
    const anchor = makeQuoteAnchor(text, start, start + 4)
    const changed = `Yesterday: ${text}`
    expect(resolveQuoteRange(changed, 'bank', anchor)).toEqual({ start: start + 11, end: start + 15 })
  })

  it('uses one whitespace convention for offsets, matching, and context', () => {
    const text = '  Use    repeated\t spaces\n in this sentence.  '
    const clean = normalizeQuoteText(text)
    const start = clean.indexOf('repeated')
    const quote = 'repeated    spaces\n in'
    const anchor = makeQuoteAnchor(text, start, start + normalizeQuoteText(quote).length)
    expect(resolveQuoteRange(text, quote, anchor)).toEqual({ start, end: start + 18 })
    expect(quoteRanges('Word\tMeaning\nbank\triver edge', 'bank river edge')).toEqual([{ start: 13, end: 28 }])
  })

  it('does not guess when a changed passage has indistinguishable occurrences', () => {
    const anchor = { start: 100, end: 104, prefix: 'removed context ', suffix: ' removed context' }
    expect(resolveQuoteRange('bank / bank', 'bank', anchor)).toBeNull()
  })

  it('rejects malformed or unbounded persisted anchor values', () => {
    expect(validQuoteAnchor(makeQuoteAnchor('bank', 0, 4))).toBe(true)
    for (const value of [null, {}, { start: -1, end: 4, prefix: '', suffix: '' },
      { start: 0, end: 0, prefix: '', suffix: '' }, { start: 0, end: 4, prefix: 'x'.repeat(49), suffix: '' }]) {
      expect(validQuoteAnchor(value)).toBe(false)
    }
  })
})
