import type { Block, Lang, ReadMode } from '@shared/types'
import { normalizeQuoteText, quoteAnchorScore, resolveQuoteRange, type QuoteAnchor } from '../../shared/quote-anchor'

export type NoteLocationTarget = {
  blockId: string | null
  blockKey: string | null
  quote: string
  quoteLang: Lang
  quoteAnchor?: QuoteAnchor
}

export type NoteLocation = {
  block: Block | null
  reason: 'translation-missing' | 'block-missing' | null
  quoteFound: boolean
}

export function resolveNoteBlock(
  target: NoteLocationTarget,
  source: Block[],
  zh: Block[] | null
): NoteLocation {
  const blocks = target.quoteLang === 'zh' ? zh : source
  if (blocks === null) return { block: null, reason: 'translation-missing', quoteFound: false }

  const quote = normalizeQuoteText(target.quote)
  const hasQuote = (block: Block) => quote.length > 0 && normalizeQuoteText(block.text).includes(quote)
  const found = (block: Block): NoteLocation => ({ block, reason: null, quoteFound: hasQuote(block) })
  const missing: NoteLocation = { block: null, reason: 'block-missing', quoteFound: false }

  if (target.blockId !== null) {
    const matchingIds = blocks.flatMap((owner) => {
      const matches: Block[] = []
      const visit = (block: Block) => {
        if (block.id === target.blockId) matches.push(owner)
        block.items?.forEach(visit)
      }
      visit(owner)
      return matches
    })
    if (matchingIds.length === 1) return found(matchingIds[0])
    if (matchingIds.length > 1) {
      const matchingKeys = matchingIds.filter((block) => block.key === target.blockKey)
      return matchingKeys.length === 1 ? found(matchingKeys[0]) : missing
    }
  }

  if (target.blockKey !== null) {
    const matchingKeys = blocks.filter((block) => block.key === target.blockKey)
    if (matchingKeys.length === 1) return found(matchingKeys[0])
    if (matchingKeys.length > 1) return missing
  }

  const matchingQuotes = blocks.filter(hasQuote)
  if (matchingQuotes.length === 1) return found(matchingQuotes[0])
  if (matchingQuotes.length > 1 && target.quoteAnchor) {
    const anchor = target.quoteAnchor
    const ranked = matchingQuotes.flatMap((block) => {
      const range = resolveQuoteRange(block.text, quote, anchor)
      return range ? [{ block, score: quoteAnchorScore(block.text, range, anchor) }] : []
    }).sort((a, b) => b.score - a.score)
    const required = Math.min(8, anchor.prefix.length + anchor.suffix.length)
    if (ranked[0]?.score > 0 && ranked[0].score >= required && ranked[0].score > (ranked[1]?.score ?? -1)) return found(ranked[0].block)
  }
  return missing
}

export function noteReadMode(current: ReadMode, lang: Lang): ReadMode {
  return current === 'bilingual' ? current : lang
}
