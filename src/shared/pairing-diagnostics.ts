import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { ParsedDoc } from './markdown'
import { alignTranslatedBlocks, translationContentHash } from './translation-alignment'
import type { TranslationAlignment } from './translation'
import type { Block, Lang } from './types'

export type PairingLocation = {
  side: Lang
  /** The existing top-level reading row, including when the problem is nested. */
  blockKey: string | null
  nestedBlockKey?: string
  /** One-based lines in the original file, including YAML frontmatter. */
  line: number
  endLine: number
  markerLine?: number
}

export type PairingIssueKind = 'duplicate-marker' | 'unassigned-marker' | 'unmatched-marker' |
  'unmarked-block' | 'marker-order' | 'block-shape' | 'stale-sidecar' | 'invalid-sidecar'

export type PairingIssue = {
  id: string
  kind: PairingIssueKind
  severity: 'info' | 'warning'
  markerId?: string
  source?: PairingLocation
  zh?: PairingLocation
}

export type PairingReport = {
  status: 'missing-companion' | 'unmarked' | 'unmatched' | 'partial' | 'complete'
  method: 'markers' | 'translation-sidecar' | 'none'
  totalSource: number
  totalZh: number
  pairedSource: number
  pairedZh: number
  /** The current reader's behavior; diagnostics do not change its rows. */
  independent: boolean
  sidecar: 'absent' | 'valid' | 'stale' | 'invalid'
  issues: PairingIssue[]
}

export type PairingInput = {
  sourceText: string
  zhText: string | null
  source: ParsedDoc
  zh: ParsedDoc | null
  alignment?: TranslationAlignment | null
  /** The main process may have discarded stale or malformed metadata already. */
  alignmentState?: PairingReport['sidecar']
}

type Position = { start: { offset: number }; end: { offset: number } }
type MdNode = {
  type: string
  value?: string
  children?: MdNode[]
  position?: Position
  annotation?: Marker
}
type Marker = { id: string; offset: number; end: number; descriptor?: Descriptor }
type Descriptor = { node: MdNode; marker?: Marker; children: Descriptor[]; block?: Block; owner?: Block }
type Scan = { text: string; side: Lang; markers: Marker[]; roots: Descriptor[]; all: Descriptor[] }
const MARKER = /^<!--\s*block:([A-Za-z0-9_-]+)\s*-->/
const CONTENT = new Set(['heading', 'paragraph', 'code', 'table', 'thematicBreak', 'blockquote'])

/** Read-only structural diagnostics. Equal paragraph counts are never proof of pairing,
 * and matching IDs or a versioned map say nothing about translation accuracy. */
export function inspectPairing(input: PairingInput): PairingReport {
  const source = scanDocument(input.sourceText, input.source.blocks, 'source')
  const target = scanDocument(input.zhText ?? '', input.zh?.blocks ?? [], 'zh')
  const issues: PairingIssue[] = []
  const issueCounts = new Map<string, number>()
  const add = (kind: PairingIssueKind, left?: PairingLocation, right?: PairingLocation, markerId?: string) => {
    const identity = `${kind}:${markerId ?? ''}:${left?.line ?? ''}:${right?.line ?? ''}`
    const occurrence = issueCounts.get(identity) ?? 0
    issueCounts.set(identity, occurrence + 1)
    issues.push({ id: occurrence ? `${identity}:${occurrence}` : identity, kind,
      severity: kind === 'unmarked-block' ? 'info' : 'warning', markerId, source: left, zh: right })
  }
  const sidecar = sidecarState(input)
  // A hash difference or unusable record cannot identify which paragraph changed.
  // Report the record itself without presenting an arbitrary prose line as faulty.
  if (sidecar === 'stale' || sidecar === 'invalid') add(`${sidecar}-sidecar`)
  const leftById = markerIndex(source)
  const rightById = markerIndex(target)
  for (const scan of [source, target]) {
    const index = scan.side === 'source' ? leftById : rightById
    for (const markers of index.values()) {
      if (markers.length > 1) {
        for (const marker of markers.slice(1)) {
          const location = markerLocation(scan, marker)
          add('duplicate-marker', scan.side === 'source' ? location : undefined,
            scan.side === 'zh' ? location : undefined, marker.id)
        }
      }
    }
    for (const marker of scan.markers) {
      if (!marker.descriptor) {
        const location = markerLocation(scan, marker)
        add('unassigned-marker', scan.side === 'source' ? location : undefined,
          scan.side === 'zh' ? location : undefined, marker.id)
      }
    }
  }

  if (!input.zh || !input.zhText?.trim()) {
    return { status: 'missing-companion', method: 'none', totalSource: source.roots.length, totalZh: 0,
      pairedSource: 0, pairedZh: 0, independent: true, sidecar, issues }
  }
  const current = alignTranslatedBlocks(input.source.blocks, input.zh.blocks, input.sourceText,
    input.zhText, alignmentSchema(input.alignment) ? input.alignment : null)

  const markerPairs: Array<{ id: string; left: Descriptor; right: Descriptor }> = []
  const unique = (index: Map<string, Marker[]>, id: string) => {
    const markers = index.get(id)
    return markers?.length === 1 ? markers[0].descriptor : undefined
  }
  for (const [id, markers] of leftById) {
    const left = unique(leftById, id)
    const right = unique(rightById, id)
    if (left && right) markerPairs.push({ id, left, right })
    else if (left && !rightById.has(id)) add('unmatched-marker', descriptorLocation(source, left), undefined, id)
    // All duplicate occurrences were reported above. A missing partner on the other
    // side remains useful even when this side's ID was repeated.
    else if (!rightById.has(id) && markers.length > 1) add('unmatched-marker', markerLocation(source, markers[0]), undefined, id)
  }
  for (const [id, markers] of rightById) {
    if (!leftById.has(id)) add('unmatched-marker', undefined, markerLocation(target, markers[0]), id)
  }

  const outOfOrder = new Set<string>()
  const sourceOrder = markerPairs.slice().sort((a, b) => offset(a.left) - offset(b.left))
  const targetOrder = markerPairs.slice().sort((a, b) => offset(a.right) - offset(b.right))
  sourceOrder.forEach((pair, index) => {
    if (pair.id !== targetOrder[index].id) {
      outOfOrder.add(pair.id)
      add('marker-order', descriptorLocation(source, pair.left), descriptorLocation(target, pair.right), pair.id)
    }
  })
  const goodRootPairs = new Set<Descriptor>()
  for (const pair of markerPairs) {
    if (!sameStructure(pair.left.block!, pair.right.block!)) {
      add('block-shape', descriptorLocation(source, pair.left), descriptorLocation(target, pair.right), pair.id)
    } else if (!outOfOrder.has(pair.id) && source.roots.includes(pair.left) && target.roots.includes(pair.right)) {
      goodRootPairs.add(pair.left)
    }
  }

  let method: PairingReport['method'] = source.markers.length || target.markers.length ? 'markers' : 'none'
  let paired = goodRootPairs.size
  if (sidecar === 'valid' && current.rows.every((row) => row.key.startsWith('t:')) && current.rows.length > 0) {
    method = 'translation-sidecar'
    paired = 0
    current.rows.forEach((row, index) => {
      if (row.source && row.zh && sameStructure(row.source, row.zh)) paired += 1
      else if (!issues.some((issue) => issue.kind === 'block-shape' && issue.source?.blockKey === row.source?.key)) {
        add('block-shape', descriptorLocation(source, source.roots[index]), descriptorLocation(target, target.roots[index]))
      }
    })
  } else if (method === 'markers') {
    for (const scan of [source, target]) {
      for (const descriptor of scan.roots) {
        if (!descriptor.marker) {
          const location = descriptorLocation(scan, descriptor)
          add('unmarked-block', scan.side === 'source' ? location : undefined, scan.side === 'zh' ? location : undefined)
        }
      }
    }
  }
  const fullyCovered = paired > 0 && paired === source.roots.length && paired === target.roots.length
  const structuralProblem = issues.some((issue) => !['stale-sidecar', 'invalid-sidecar'].includes(issue.kind))
  const status = fullyCovered && !structuralProblem ? 'complete' : paired > 0 ? 'partial' :
    method === 'none' ? 'unmarked' : 'unmatched'
  return { status, method, totalSource: source.roots.length, totalZh: target.roots.length,
    pairedSource: paired, pairedZh: paired, independent: current.independent, sidecar,
    issues: issues.sort((a, b) => (a.source?.line ?? a.zh?.line ?? 0) - (b.source?.line ?? b.zh?.line ?? 0) || a.id.localeCompare(b.id)) }
}

function sidecarState(input: PairingInput): PairingReport['sidecar'] {
  if (input.alignmentState === 'stale' || input.alignmentState === 'invalid') return input.alignmentState
  const alignment = input.alignment
  if (!alignment) return input.alignmentState === 'valid' ? 'invalid' : 'absent'
  if (!alignmentSchema(alignment)) return 'invalid'
  if (alignment.sourceHash !== translationContentHash(input.sourceText) ||
      alignment.targetHash !== translationContentHash(input.zhText ?? '')) return 'stale'
  if (!input.zh) return 'invalid'
  const paired = alignTranslatedBlocks(input.source.blocks, input.zh.blocks, input.sourceText, input.zhText ?? '', alignment)
  return !paired.independent && paired.rows.length > 0 && paired.rows.every((row) => row.key.startsWith('t:')) ? 'valid' : 'invalid'
}

function alignmentSchema(alignment: TranslationAlignment | null | undefined): alignment is TranslationAlignment {
  return !!alignment && typeof alignment.sourceHash === 'string' && typeof alignment.targetHash === 'string' &&
    Array.isArray(alignment.pairs) && alignment.pairs.every((pair) => !!pair && typeof pair.sourceKey === 'string' && typeof pair.targetKey === 'string')
}

function markerIndex(scan: Scan) {
  const result = new Map<string, Marker[]>()
  for (const marker of scan.markers) result.set(marker.id, [...result.get(marker.id) ?? [], marker])
  return result
}

function sameStructure(left: Block, right: Block): boolean {
  if (left.kind !== right.kind || left.depth !== right.depth || left.marker !== right.marker || left.checked !== right.checked) return false
  if (left.kind === 'table') {
    const leftRows = [...left.header ?? [], ...left.rows ?? []]
    const rightRows = [...right.header ?? [], ...right.rows ?? []]
    if (leftRows.length !== rightRows.length || leftRows.some((row, index) => row.length !== rightRows[index].length)) return false
  }
  const leftItems = left.items ?? []
  const rightItems = right.items ?? []
  return leftItems.length === rightItems.length && leftItems.every((item, index) => sameStructure(item, rightItems[index]))
}

/** Follow the parser's annotation rules without sharing or mutating its AST/blocks.
 * This is also why marker examples inside code and YAML are not diagnostics. */
function scanDocument(text: string, blocks: Block[], side: Lang): Scan {
  const bodyOffset = frontmatterOffset(text)
  const body = text.slice(bodyOffset)
  const parse = (value: string) => unified().use(remarkParse).use(remarkGfm).parse(value) as unknown as MdNode
  const tree = parse(body)
  const markers: Marker[] = []
  const shift = (node: MdNode, amount: number) => {
    if (node.position) {
      node.position.start.offset += amount
      node.position.end.offset += amount
    }
    node.children?.forEach((child) => shift(child, amount))
  }
  shift(tree, bodyOffset)
  const expand = (parent: MdNode) => {
    parent.children = parent.children?.flatMap((node) => {
      if (node.type === 'html' && node.value) {
        const standalone = /^\s*(<!--\s*block:[A-Za-z0-9_-]+\s*-->)\s*$/.exec(node.value)
        const leading = standalone ? node.value.indexOf(standalone[1]) : 0
        const match = MARKER.exec(standalone ? standalone[1] : node.value)
        if (match) {
          const start = (node.position?.start.offset ?? bodyOffset) + leading
          const annotation = { id: match[1], offset: start, end: start + match[0].length }
          markers.push(annotation)
          const rest = standalone ? '' : node.value.slice(match[0].length)
          if (rest.trim()) {
            const trailing = parse(rest)
            shift(trailing, start + match[0].length)
            expand(trailing)
            return [{ type: 'html', value: match[0], annotation,
              position: { start: { offset: start }, end: { offset: annotation.end } } } as MdNode, ...trailing.children ?? []]
          }
          node.annotation = annotation
        } else {
          // Unsupported placement is still an explicit annotation worth locating;
          // keep it unassigned, rather than silently granting it a reading pair.
          for (const comment of node.value.matchAll(/<!--\s*block:([A-Za-z0-9_-]+)\s*-->/g)) {
            const start = (node.position?.start.offset ?? bodyOffset) + comment.index
            markers.push({ id: comment[1], offset: start, end: start + comment[0].length })
          }
        }
      }
      expand(node)
      return [node]
    })
  }
  expand(tree)
  const annotation = (node: MdNode) => node.type === 'html' && node.value &&
    /^<!--\s*block:[A-Za-z0-9_-]+\s*-->$/.test(node.value.trim()) ? node.annotation : undefined
  const stripLeading = (node: MdNode): Marker | undefined => {
    const first = node.children?.[0]
    if (!first) return undefined
    const marker = annotation(first)
    if (marker) { node.children?.shift(); return marker }
    return first.type === 'paragraph' ? stripLeading(first) : undefined
  }
  const all: Descriptor[] = []
  const visit = (nodes: MdNode[]): Descriptor[] => {
    const result: Descriptor[] = []
    let pending: Marker | undefined
    const add = (node: MdNode, inline?: Marker, children: Descriptor[] = []) => {
      const marker = pending ?? inline
      pending = undefined
      const descriptor: Descriptor = { node, marker, children }
      if (marker) marker.descriptor = descriptor
      result.push(descriptor)
      all.push(descriptor)
      return descriptor
    }
    for (const node of nodes) {
      const marker = annotation(node)
      if (marker) { pending = marker; continue }
      if (node.type === 'list') {
        for (const item of node.children ?? []) {
          const inline = stripLeading(item)
          const descriptor = add(item, inline)
          descriptor.children = visit(item.children ?? [])
        }
      } else if (node.type === 'blockquote') {
        const descriptor = add(node)
        descriptor.children = visit(node.children ?? [])
      } else if (CONTENT.has(node.type)) add(node, stripLeading(node))
      else if (node.type !== 'html' && node.type !== 'definition' && node.children) result.push(...visit(node.children))
    }
    return result
  }
  const roots = visit(tree.children ?? [])
  const attach = (descriptors: Descriptor[], parsed: Block[], owner?: Block) => {
    descriptors.forEach((descriptor, index) => {
      descriptor.block = parsed[index]
      descriptor.owner = owner ?? parsed[index]
      attach(descriptor.children, parsed[index]?.items ?? [], owner ?? parsed[index])
    })
  }
  attach(roots, blocks)
  return { text, side, markers, roots, all }
}

function frontmatterOffset(text: string): number {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return 0
  const end = text.search(/\r?\n---\s*(?:\r?\n|$)/)
  if (end === -1) return 0
  const removed = /^\r?\n---\s*/.exec(text.slice(end))?.[0].length ?? 0
  return end + removed
}

function offset(descriptor: Descriptor) { return descriptor.marker?.offset ?? descriptor.node.position?.start.offset ?? 0 }
function lineAt(text: string, position: number) { return text.slice(0, position).split('\n').length }
function descriptorLocation(scan: Scan, descriptor: Descriptor): PairingLocation {
  const start = descriptor.node.position?.start.offset ?? descriptor.marker?.offset ?? 0
  const end = descriptor.node.position?.end.offset ?? start
  return { side: scan.side, blockKey: descriptor.owner?.key ?? null,
    ...(descriptor.block && descriptor.block !== descriptor.owner ? { nestedBlockKey: descriptor.block.key } : {}),
    line: lineAt(scan.text, start), endLine: lineAt(scan.text, Math.max(start, end - 1)),
    ...(descriptor.marker ? { markerLine: lineAt(scan.text, descriptor.marker.offset) } : {}) }
}
function markerLocation(scan: Scan, marker: Marker): PairingLocation {
  if (marker.descriptor) return descriptorLocation(scan, marker.descriptor)
  const containing = scan.all.filter((item) => (item.node.position?.start.offset ?? Infinity) <= marker.offset &&
    (item.node.position?.end.offset ?? -1) >= marker.end).sort((a, b) =>
      ((a.node.position?.end.offset ?? 0) - (a.node.position?.start.offset ?? 0)) -
      ((b.node.position?.end.offset ?? 0) - (b.node.position?.start.offset ?? 0)))[0]
  const nearby = containing ?? scan.roots.find((item) => (item.node.position?.start.offset ?? 0) >= marker.offset) ?? scan.roots.at(-1)
  return { side: scan.side, blockKey: nearby?.owner?.key ?? null, line: lineAt(scan.text, marker.offset),
    endLine: lineAt(scan.text, Math.max(marker.offset, marker.end - 1)), markerLine: lineAt(scan.text, marker.offset) }
}
