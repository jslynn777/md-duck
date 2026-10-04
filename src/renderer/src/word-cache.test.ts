import { describe, expect, it } from 'vitest'
import { savedWordExplanation } from './word-cache'
import type { LearnedWord } from '@shared/types'

const bank: LearnedWord = {
  id: 'saved-bank', word: 'bank', key: 'bank', sentence: 'We sat on the river bank.',
  meaning: '河岸', blockId: null, createdAt: '2026-09-28T00:00:00Z',
  explanation: { lemma: 'bank', partOfSpeech: '名词', meaning: '河岸' }
}

describe('saved contextual explanations', () => {
  it('does not reuse a previous meaning for the same word in another sentence', () => {
    expect(savedWordExplanation(bank, 'The bank approved the payment.')).toBeUndefined()
    expect(savedWordExplanation(bank, bank.sentence)?.meaning).toBe('河岸')
  })

  it('leaves legacy saved words intact but requests a richer explanation', () => {
    const legacy = { ...bank, explanation: undefined }
    expect(savedWordExplanation(legacy, legacy.sentence)).toBeUndefined()
    expect(legacy.meaning).toBe('河岸')
  })

  it('ignores malformed cached content and does not render unvalidated optional fields', () => {
    expect(savedWordExplanation({ ...bank, explanation: { meaning: {} } as never }, bank.sentence)).toBeUndefined()
    const malformed = { ...bank, explanation: { ...bank.explanation!, formNote: {} as never, memoryHint: {} as never } }
    expect(savedWordExplanation(malformed, bank.sentence)).toEqual(bank.explanation)
  })
})
