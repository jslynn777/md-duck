import type { LearnedWord } from '@shared/types'
import type { WordExplanation } from '@shared/word-help'

// Saved vocabulary is reusable only in the sentence it was explained in.
export function savedWordExplanation(saved: LearnedWord | undefined, sentence: string): WordExplanation | undefined {
  if (!saved || saved.sentence !== sentence) return undefined
  const value = saved.explanation
  if (!value || typeof value.lemma !== 'string' || typeof value.partOfSpeech !== 'string'
    || typeof value.meaning !== 'string' || !value.meaning.trim()) return undefined
  return {
    lemma: value.lemma,
    partOfSpeech: value.partOfSpeech,
    meaning: value.meaning,
    ...(typeof value.formNote === 'string' ? { formNote: value.formNote } : {})
  }
}
