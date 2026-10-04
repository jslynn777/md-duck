import { alignBlocks } from './markdown'
import type { AlignRow, Block } from './types'
import type { TranslationAlignment } from './translation'

/** A content-version fingerprint, not a security or authentication primitive. */
export function translationContentHash(text: string): string {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `${text.length}:${hash.toString(16)}`
}

/** Uses versioned sidecar pairs without changing block IDs or annotation keys. */
export function alignTranslatedBlocks(
  source: Block[],
  target: Block[],
  sourceText: string,
  targetText: string,
  alignment: TranslationAlignment | null | undefined
): { rows: AlignRow[]; independent: boolean; warning: string | null } {
  if (!alignment || alignment.sourceHash !== translationContentHash(sourceText) ||
      alignment.targetHash !== translationContentHash(targetText) ||
      source.length !== target.length) {
    return alignBlocks(source, target)
  }
  const exact = alignment.pairs.length === source.length && source.every((left, index) =>
    alignment.pairs[index].sourceKey === left.key && alignment.pairs[index].targetKey === target[index].key && sameShape(left, target[index]))
  if (!exact && !matchesLegacyStructure(source, target, alignment)) return alignBlocks(source, target)
  const rows: AlignRow[] = []
  for (let index = 0; index < source.length; index += 1) {
    const left = source[index]
    const right = target[index]
    rows.push({ key: `t:${left.key}`, source: left, zh: right })
  }
  return { rows, independent: false, warning: null }
}

function sameShape(left: Block, right: Block) {
  return left.kind === right.kind && left.depth === right.depth && left.marker === right.marker && left.checked === right.checked
}

type LegacyRow = { key: string; block: Block; owner: number; path: string }

/** Before structural rendering, direct nested list items were separate rows and
 * reference-only image paragraphs used a paragraph key. Reconstruct only those
 * known rows, including their old document-wide duplicate-key suffixes. */
function legacyRows(blocks: Block[]): { rows: LegacyRow[]; changed: boolean } {
  const rows: LegacyRow[] = []
  const counts = new Map<string, number>()
  let changed = false
  const visit = (block: Block, owner: number, path: string) => {
    let base = block.key.replace(/#\d+$/, '')
    const referenceImage = block.kind === 'image' && /^!\[(?:\\.|[^\]\\])*\](?:\s*\[(?:\\.|[^\]\\])*\])?\s*$/.test(block.source.trim())
    if (referenceImage && base.startsWith('auto:')) { base = base.replace(/:image$/, ':paragraph'); changed = true }
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    rows.push({ key: count ? `${base}#${count}` : base, block, owner, path })
    if (block.kind === 'listItem') {
      const children = block.items?.filter((item) => item.kind === 'listItem') ?? []
      children.forEach((child, index) => { changed = true; visit(child, owner, `${path}/${index}`) })
    }
  }
  blocks.forEach((block, index) => visit(block, index, ''))
  return { rows, changed }
}

function matchesLegacyStructure(source: Block[], target: Block[], alignment: TranslationAlignment): boolean {
  const left = legacyRows(source)
  const right = legacyRows(target)
  if (!left.changed || !right.changed || alignment.pairs.length !== left.rows.length || left.rows.length !== right.rows.length) return false
  return left.rows.every((row, index) => {
    const other = right.rows[index]
    const pair = alignment.pairs[index]
    return pair.sourceKey === row.key && pair.targetKey === other.key && row.owner === other.owner && row.path === other.path && sameShape(row.block, other.block)
  })
}
