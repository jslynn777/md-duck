import { describe, expect, it } from 'vitest'
import { sentenceAt } from './sentence-context'

describe('sentenceAt', () => {
  it('uses the clicked occurrence when a word appears in more than one sentence', () => {
    const text = 'The bank approved the loan. We sat on the bank beside the river.'
    expect(sentenceAt(text, text.indexOf('bank'))).toBe('The bank approved the loan.')
    expect(sentenceAt(text, text.lastIndexOf('bank'))).toBe('We sat on the bank beside the river.')
  })

  it('does not confuse a clicked word with an earlier substring', () => {
    const text = 'The banker left early. We sat on the bank.'
    expect(sentenceAt(text, text.lastIndexOf('bank'))).toBe('We sat on the bank.')
  })

  it('normalizes whitespace after choosing the sentence at the raw DOM offset', () => {
    const text = 'The bank approved it.\n\nWe\t sat on   the bank.'
    expect(sentenceAt(text, text.lastIndexOf('bank'))).toBe('We sat on the bank.')
  })

  it('does not mistake a decimal point for the end of a sentence', () => {
    const text = 'Use ribbon that is 2.5 inches wide. Another ribbon is available.'
    expect(sentenceAt(text, text.indexOf('inches'))).toBe('Use ribbon that is 2.5 inches wide.')
  })

  it('includes closing punctuation in the sentence and handles unpunctuated headings', () => {
    const quote = 'He said “Use ribbon.” Another material is available.'
    expect(sentenceAt(quote, quote.indexOf('ribbon'))).toBe('He said “Use ribbon.”')
    expect(sentenceAt('Choosing the right ribbon', 19)).toBe('Choosing the right ribbon')
  })

  it('handles an empty text container', () => {
    expect(sentenceAt('', 0)).toBe('')
  })
})
