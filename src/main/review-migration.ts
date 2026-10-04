import { parseDocument } from '../shared/markdown'
import type { LearnedWord, Note } from '../shared/types'
import { splitWords, wordKey } from '../shared/words'

type Candidate = { name: string; sourceText: string; zhText?: string | null }
type Review = { notes: Note[]; words: LearnedWord[] }
export type LegacyReviewMigration = {
  documents: Record<string, Review>
  unassigned: Review
}

/** Plan once against the original directory; the caller preserves the legacy files. */
export function planLegacyReviewMigration(
  candidates: Candidate[],
  notes: Note[],
  words: LearnedWord[]
): LegacyReviewMigration {
  const documents: Record<string, Review> = Object.fromEntries(
    candidates.map(({ name }) => [name, { notes: [], words: [] }])
  )
  const unassigned: Review = { notes: [], words: [] }
  if (candidates.length === 1) {
    documents[candidates[0].name] = { notes: [...notes], words: [...words] }
    return { documents, unassigned }
  }

  const texts = candidates.map(({ name, sourceText, zhText }) => {
    const source = readableText(sourceText)
    return {
      name,
      source,
      zh: zhText ? readableText(zhText) : '',
      tokens: new Set(splitWords(source).filter((part) => part.word).map((part) => wordKey(part.text)))
    }
  })

  for (const note of notes) {
    const quote = normalize(note.quote)
    // Block IDs are only unique inside an article and cannot establish ownership.
    const matches = quote ? texts.filter((text) => (note.quoteLang === 'zh' ? text.zh : text.source).includes(quote)) : []
    const target = matches.length === 1 ? documents[matches[0].name] : unassigned
    target.notes.push(note)
  }

  for (const word of words) {
    const sentence = normalize(word.sentence)
    const token = wordKey(word.word)
    // A stale sentence is evidence of an unresolved location, not permission to guess from its word.
    const matches = sentence
      ? texts.filter((text) => text.source.includes(sentence))
      : token ? texts.filter((text) => text.tokens.has(token)) : []
    const target = matches.length === 1 ? documents[matches[0].name] : unassigned
    target.words.push(word)
  }

  return { documents, unassigned }
}

function readableText(markdown: string): string {
  return normalize(parseDocument(markdown, '').blocks.map((block) => block.text).join('\n'))
}

function normalize(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}
