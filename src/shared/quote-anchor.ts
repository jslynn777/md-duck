/** Offsets refer to normalized block text, never to Markdown source bytes. */
export type QuoteAnchor = { start: number; end: number; prefix: string; suffix: string }
export type QuoteRange = { start: number; end: number }

export function validQuoteAnchor(value: unknown): value is QuoteAnchor {
  if (!value || typeof value !== 'object') return false
  const anchor = value as Partial<QuoteAnchor>
  return Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.start! >= 0 && anchor.end! > anchor.start! &&
    typeof anchor.prefix === 'string' && typeof anchor.suffix === 'string' && anchor.prefix.length <= 48 && anchor.suffix.length <= 48
}

export function normalizeQuoteText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function makeQuoteAnchor(text: string, start: number, end: number): QuoteAnchor | undefined {
  const clean = normalizeQuoteText(text)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > clean.length) return undefined
  return { start, end, prefix: clean.slice(Math.max(0, start - 48), start), suffix: clean.slice(end, end + 48) }
}

function commonEnd(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - n - 1] === b[b.length - n - 1]) n += 1
  return n
}

function commonStart(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1
  return n
}

/** Context is used to move a quote after surrounding edits, rather than taking the first occurrence. */
export function quoteAnchorScore(text: string, range: QuoteRange, anchor: QuoteAnchor): number {
  const clean = normalizeQuoteText(text)
  return commonEnd(clean.slice(0, range.start), anchor.prefix) + commonStart(clean.slice(range.end), anchor.suffix)
}

export function quoteRanges(text: string, quote: string): QuoteRange[] {
  const clean = normalizeQuoteText(text)
  const needle = normalizeQuoteText(quote)
  if (!needle) return []
  const ranges: QuoteRange[] = []
  let from = 0
  while (from <= clean.length - needle.length) {
    const start = clean.indexOf(needle, from)
    if (start < 0) break
    ranges.push({ start, end: start + needle.length })
    from = start + 1
  }
  return ranges
}

export function resolveQuoteRange(text: string, quote: string, anchor?: QuoteAnchor): QuoteRange | null {
  const ranges = quoteRanges(text, quote)
  if (ranges.length === 1) return ranges[0]
  if (!anchor || ranges.length === 0) return null
  const clean = normalizeQuoteText(text)
  // Prefer the stored range only when its surroundings still identify the same occurrence.
  const exact = ranges.find((range) => range.start === anchor.start && range.end === anchor.end)
  if (exact && clean.slice(Math.max(0, exact.start - anchor.prefix.length), exact.start) === anchor.prefix &&
      clean.slice(exact.end, exact.end + anchor.suffix.length) === anchor.suffix) return exact
  const ranked = ranges.map((range) => ({ range, score: quoteAnchorScore(clean, range, anchor) })).sort((a, b) => b.score - a.score)
  const required = Math.min(8, anchor.prefix.length + anchor.suffix.length)
  if (ranked[0].score === 0 || ranked[0].score < required || ranked[0].score === ranked[1]?.score) return null
  return ranked[0].range
}
