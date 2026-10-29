import { parseDocument } from './markdown'
import type { Block } from './types'

/** The two texts that were actually displayed together in the reader. */
export type DocumentContent = { sourceText: string; zhText: string | null }
export type DocumentChangeState = {
  documentId: string
  revision: string
  baseline: DocumentContent
  current: DocumentContent
  changed: boolean
  baselineAt: string
  issue?: string
}
export type ArticleChangeSummary = { changed: boolean; source: boolean; translation: boolean; issue?: string }
export type DocumentChange = {
  id: string
  side: 'source' | 'zh'
  kind: 'added' | 'modified' | 'deleted' | 'moved'
  before: string
  after: string
  targetKey: string | null
  beforeKey?: string
  afterKey?: string
}

/** Compare the confirmed text with the text now shown, without changing either. */
export function compareDocumentChanges(baseline: DocumentContent, current: DocumentContent): DocumentChange[] {
  const changes = [
    ...compareSide(baseline.sourceText, current.sourceText, 'source'),
    ...compareSide(baseline.zhText ?? '', current.zhText ?? '', 'zh')
  ]
  if (baseline.zhText !== current.zhText && !changes.some(change => change.side === 'zh')) {
    changes.push({ id: 'zh:presence', side: 'zh', kind: current.zhText === null ? 'deleted' : 'added',
      before: baseline.zhText ?? '', after: current.zhText ?? '', targetKey: null })
  }
  return changes
}

function compareSide(before: string, after: string, side: DocumentChange['side']): DocumentChange[] {
  if (before === after) return []
  const oldBlocks = parseDocument(before, '').blocks
  const newBlocks = parseDocument(after, '').blocks
  return compareBlocks(oldBlocks, newBlocks, side, before, after)
}

function signature(block: Block): string {
  // Source catches Markdown formatting and destination changes; rendered fields
  // also catch reference-link definitions outside a paragraph's source range.
  return JSON.stringify([block.kind, block.source, block.depth, block.marker, block.checked,
    block.inlines, block.header, block.rows, block.lang, block.code, block.items?.map(signature)])
}

function uniqueIds(blocks: Block[]): Map<string, number> {
  const matches = new Map<string, number>(), duplicates = new Set<string>()
  blocks.forEach((block, index) => {
    if (!block.id) return
    if (matches.has(block.id)) duplicates.add(block.id)
    else matches.set(block.id, index)
  })
  for (const id of duplicates) matches.delete(id)
  return matches
}

/** Longest increasing subsequence, without a document-sized quadratic table. */
function stationaryPairs(oldToNew: Map<number, number>): Set<number> {
  const pairs = [...oldToNew].sort((a, b) => a[0] - b[0])
  const tails: number[] = []
  const previous = new Int32Array(pairs.length).fill(-1)
  pairs.forEach(([, value], index) => {
    let low = 0, high = tails.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (pairs[tails[mid]][1] < value) low = mid + 1
      else high = mid
    }
    if (low) previous[index] = tails[low - 1]
    tails[low] = index
  })
  const result = new Set<number>()
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) result.add(pairs[index][0])
  return result
}

function compareBlocks(old: Block[], next: Block[], side: DocumentChange['side'], before: string, after: string): DocumentChange[] {
  const oldToNew = new Map<number, number>(), newToOld = new Map<number, number>()
  const oldSignatures = old.map(signature), nextSignatures = next.map(signature)
  const pair = (oldIndex: number, newIndex: number) => {
    oldToNew.set(oldIndex, newIndex); newToOld.set(newIndex, oldIndex)
  }
  const oldIds = uniqueIds(old), newIds = uniqueIds(next)
  old.forEach((block, index) => {
    const match = block.id && oldIds.get(block.id) === index ? newIds.get(block.id) : undefined
    if (match !== undefined) pair(index, match)
  })

  // Pair unchanged unmarked blocks by occurrence, not with a map that silently
  // discards repeated paragraphs. Marked content keeps its explicit identity.
  const queues = new Map<string, { indices: number[]; cursor: number }>()
  next.forEach((block, index) => {
    if (newToOld.has(index) || block.id) return
    const key = nextSignatures[index]
    const queue = queues.get(key) ?? { indices: [], cursor: 0 }
    queue.indices.push(index); queues.set(key, queue)
  })
  old.forEach((block, index) => {
    if (oldToNew.has(index) || block.id) return
    const queue = queues.get(oldSignatures[index])
    if (queue && queue.cursor < queue.indices.length) pair(index, queue.indices[queue.cursor++])
  })

  const anchors = [...stationaryPairs(oldToNew)].sort((a, b) => a - b)
  let oldStart = 0, newStart = 0
  // Within the gaps between trustworthy unchanged/ID anchors, edits are paired
  // in reading order. An explicit, different ID is never guessed to be the same
  // paragraph. This remains linear even for a completely rewritten long file.
  for (const anchor of [...anchors, old.length]) {
    const newEnd = anchor === old.length ? next.length : oldToNew.get(anchor)!
    const oldGap: number[] = [], newGap: number[] = []
    for (let i = oldStart; i < anchor; i++) if (!oldToNew.has(i) && (!old[i].id || !oldIds.has(old[i].id!))) oldGap.push(i)
    for (let i = newStart; i < newEnd; i++) if (!newToOld.has(i) && (!next[i].id || !newIds.has(next[i].id!))) newGap.push(i)
    for (let i = 0; i < Math.min(oldGap.length, newGap.length); i++) pair(oldGap[i], newGap[i])
    oldStart = anchor + 1; newStart = newEnd + 1
  }
  const stationary = stationaryPairs(oldToNew)
  const result: Array<{ order: number; change: DocumentChange }> = []
  const emit = (kind: DocumentChange['kind'], oldIndex: number | null, newIndex: number | null, targetIndex = newIndex) => {
    const prior = oldIndex === null ? undefined : old[oldIndex]
    const current = newIndex === null ? undefined : next[newIndex]
    const hiddenMarkupChange = prior && current && prior.source === current.source && oldSignatures[oldIndex!] !== nextSignatures[newIndex!]
    result.push({
      order: newIndex ?? (targetIndex === null ? next.length : targetIndex) - 0.5,
      change: {
        id: `${side}:${kind}:${prior?.key ?? '-'}:${current?.key ?? '-'}`,
        side, kind,
        // Reference definitions can change rendering while the visible block's
        // Markdown stays the same. Show the complete text in that unusual case.
        before: hiddenMarkupChange ? before : prior?.source ?? '',
        after: hiddenMarkupChange ? after : current?.source ?? '',
        targetKey: targetIndex === null ? null : next[targetIndex]?.key ?? null,
        ...(prior ? { beforeKey: prior.key } : {}),
        ...(current ? { afterKey: current.key } : {})
      }
    })
  }
  next.forEach((_block, index) => {
    const previousIndex = newToOld.get(index)
    if (previousIndex === undefined) emit('added', null, index)
    else if (oldSignatures[previousIndex] !== nextSignatures[index]) emit('modified', previousIndex, index)
    else if (!stationary.has(previousIndex)) emit('moved', previousIndex, index)
  })
  const preceding: Array<number | null> = [], following: Array<number | null> = []
  let neighbor: number | null = null
  old.forEach((_block, index) => { preceding[index] = neighbor; if (oldToNew.has(index)) neighbor = index })
  neighbor = null
  for (let index = old.length - 1; index >= 0; index--) { following[index] = neighbor; if (oldToNew.has(index)) neighbor = index }
  old.forEach((_block, index) => {
    if (oldToNew.has(index)) return
    // Prefer a nearby surviving paragraph. Every deletion remains inspectable
    // even when all content on that language side has been removed.
    const left = preceding[index], right = following[index]
    const closest = right !== null && (left === null || right - index <= index - left) ? right : left
    const target = closest === null ? null : oldToNew.get(closest) ?? null
    emit('deleted', index, null, target)
  })
  if (!result.length) {
    // Frontmatter, comments, markers and whitespace are still file changes.
    // A whole-text fallback prevents a pending badge with an empty review list.
    return [{ id: `${side}:document`, side, kind: 'modified', before, after, targetKey: next[0]?.key ?? null }]
  }
  return result.sort((a, b) => a.order - b.order).map(item => item.change)
}
