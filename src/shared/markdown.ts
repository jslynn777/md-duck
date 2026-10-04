import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { t } from './i18n'
import type { Block, AlignRow, Inline, Note, UiLang } from './types'
import { makeQuoteAnchor, normalizeQuoteText, quoteAnchorScore, resolveQuoteRange } from './quote-anchor'

type MdNode = {
  type: string
  value?: string
  url?: string
  alt?: string
  depth?: number
  lang?: string | null
  ordered?: boolean
  start?: number | null
  checked?: boolean | null
  identifier?: string
  children?: MdNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

export type ParsedDoc = {
  title: string
  description: string
  seo: { title: string; description: string }
  blocks: Block[]
  warnings: string[]
}

const BLOCK_RE = /^<!--\s*block:([A-Za-z0-9_-]+)\s*-->$/

export function parseDocument(markdown: string, fallbackTitle: string): ParsedDoc {
  const { data, body } = splitFrontmatter(markdown)
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body) as MdNode
  const warnings: string[] = []
  const seen = new Set<string>()
  expandInlineMarkers(tree)
  resolveReferences(tree)

  const visit = (nodes: MdNode[], depth: number): Block[] => {
    let pending: string | null = null
    const blocks: Block[] = []
    const takeId = (inlineId: string | null) => {
      let id = pending ?? inlineId
      pending = null
      if (id && seen.has(id)) {
        warnings.push(`duplicate:${id}`)
        id = null
      }
      if (id) seen.add(id)
      return id
    }
    nodes.forEach((node) => {
      const comment = commentId(node)
      if (comment) {
        if (pending) warnings.push(`unused:${pending}`)
        pending = comment
        return
      }
      if (node.type === 'list') {
        const start = node.start ?? 1
        node.children?.forEach((item, itemIndex) => {
          const inlineId = stripLeadingMarker(item)
          const id = takeId(inlineId)
          const items = visit(item.children ?? [], depth + 1)
          const marker = item.checked != null ? 'task' : node.ordered ? `${start + itemIndex}.` : '•'
          blocks.push(
            makeBlock({
              id,
              kind: 'listItem',
              depth,
              body,
              node: item,
              marker,
              checked: item.checked,
              text: items.map((child) => child.text).join('\n'),
              items
            })
          )
        })
        return
      }
      if (node.type === 'blockquote') {
        const id = takeId(null)
        const items = visit(node.children ?? [], depth)
        blocks.push(
          makeBlock({
            id,
            kind: 'blockquote',
            depth,
            body,
            node,
            inlines: [],
            text: items.map((child) => child.text).join('\n'),
            items
          })
        )
        return
      }
      if (isContent(node)) {
        const id = takeId(stripLeadingMarker(node))
        blocks.push(blockFromNode(node, id, depth, body))
        return
      }
      if (node.type !== 'html' && node.type !== 'definition' && node.children) blocks.push(...visit(node.children, depth))
    })
    if (pending) warnings.push(`unused:${pending}`)
    const keyCounts = new Map<string, number>()
    for (const block of blocks) {
      const count = keyCounts.get(block.key) ?? 0
      keyCounts.set(block.key, count + 1)
      if (count > 0) block.key = `${block.key}#${count}`
    }
    return blocks
  }
  const blocks = visit(tree.children ?? [], 0)

  const heading = blocks.find((block) => block.kind === 'heading' && block.depth === 0)
  return {
    title: data.title || heading?.text || fallbackTitle,
    description: data.description,
    seo: { title: data.title, description: data.description },
    blocks,
    warnings
  }
}

export function alignBlocks(source: Block[], zh: Block[]): { rows: AlignRow[]; independent: boolean; warning: string | null } {
  const zhIds = new Set(zh.flatMap((block) => (block.id ? [block.id] : [])))
  const anchors: string[] = []
  for (const block of source) {
    if (block.id && zhIds.has(block.id) && !anchors.includes(block.id)) anchors.push(block.id)
  }
  if (anchors.length === 0) {
    const marked = source.some((block) => block.id) || zh.some((block) => block.id)
    return {
      rows: [],
      independent: true,
      warning: marked ? 'mismatch' : 'unmarked'
    }
  }

  const sourceById = indexById(source)
  const zhById = indexById(zh)
  const sourceGaps = splitGaps(source, anchors)
  const zhGaps = splitGaps(zh, anchors)
  const rows: AlignRow[] = []
  const pushGap = (left: Block[], right: Block[]) => {
    left.forEach((block) => rows.push({ key: `s:${block.key}`, source: block }))
    right.forEach((block) => rows.push({ key: `z:${block.key}`, zh: block }))
  }
  anchors.forEach((id, index) => {
    pushGap(sourceGaps[index], zhGaps[index])
    rows.push({ key: `p:${id}`, source: sourceById.get(id), zh: zhById.get(id) })
  })
  pushGap(sourceGaps[anchors.length], zhGaps[anchors.length])
  return { rows, independent: false, warning: null }
}

export function reconcileNotes(notes: Note[], source: Block[], zh: Block[] | null): Note[] {
  return notes.map((note) => {
    const blocks = note.quoteLang === 'zh' ? zh ?? [] : source
    const resolved = note.status === 'resolved'
    if (note.blockId) {
      const owned = findBlockById(blocks, note.blockId)
      if (!owned) {
        if (resolved) return { ...note, blockKey: null, orphanReason: undefined }
        return { ...note, blockKey: null, status: 'orphaned', orphanReason: 'missing-block' }
      }
      const { block, owner } = owned
      if (resolved) return { ...note, blockKey: owner.key, orphanReason: undefined }
      if (!includesQuote(block.text, note.quote)) {
        return { ...note, blockKey: owner.key, status: 'outdated', orphanReason: undefined }
      }
      const range = resolveQuoteRange(owner.text, note.quote, note.quoteAnchor)
      return { ...note, blockKey: owner.key, quoteAnchor: range ? makeQuoteAnchor(owner.text, range.start, range.end) : note.quoteAnchor,
        status: 'open', orphanReason: undefined }
    }
    const matches = blocks.filter((block) => includesQuote(block.text, note.quote))
    const existing = matches.find((block) => block.key === note.blockKey)
    let matched = existing ?? (matches.length === 1 ? matches[0] : undefined)
    if (!matched && note.quoteAnchor) {
      const candidates = matches.flatMap((block) => {
        const range = resolveQuoteRange(block.text, note.quote, note.quoteAnchor)
        return range ? [{ block, range, score: quoteAnchorScore(block.text, range, note.quoteAnchor!) }] : []
      }).sort((a, b) => b.score - a.score)
      const required = Math.min(8, note.quoteAnchor.prefix.length + note.quoteAnchor.suffix.length)
      if (candidates[0]?.score > 0 && candidates[0].score >= required && candidates[0].score !== candidates[1]?.score) matched = candidates[0].block
    }
    if (matched) {
      const range = resolveQuoteRange(matched.text, note.quote, note.quoteAnchor)
      return { ...note, blockKey: matched.key, quoteAnchor: range ? makeQuoteAnchor(matched.text, range.start, range.end) : note.quoteAnchor,
        status: resolved ? 'resolved' : 'open', orphanReason: undefined }
    }
    if (resolved) return { ...note, blockKey: null, orphanReason: undefined }
    if (matches.length === 0) {
      return { ...note, blockKey: null, status: 'orphaned', orphanReason: 'missing-quote' }
    }
    return { ...note, blockKey: null, status: 'orphaned', orphanReason: 'ambiguous-quote' }
  })
}

export function formatTasks(
  notes: Note[],
  info: { folder: string; source: Block[]; zh: Block[] | null },
  lang: UiLang = 'en'
): string {
  const body = notes.map((note, index) => formatOne(note, index, info, lang)).join('\n\n')
  return `${body}\n\n${t(lang, 'tasksKeep')}`
}

function formatOne(
  note: Note,
  index: number,
  info: { folder: string; source: Block[]; zh: Block[] | null },
  lang: UiLang
): string {
  const ownBlocks = note.quoteLang === 'zh' ? info.zh ?? [] : info.source
  const ownBlock = note.blockId ? findBlockById(ownBlocks, note.blockId)?.block :
    ownBlocks.find((block) => block.key === note.blockKey) ?? findUnmarkedBlock(note, ownBlocks)
  const sourceBlock = note.blockId ? findBlockById(info.source, note.blockId)?.block : note.quoteLang === 'source' ? ownBlock : undefined
  const zhBlock = note.blockId ? findBlockById(info.zh ?? [], note.blockId)?.block : note.quoteLang === 'zh' ? ownBlock : undefined
  const target = !note.blockId ? t(lang, 'taskTargetNone') : sourceBlock
    ? t(lang, 'taskTargetEn', { id: note.blockId ?? '' })
    : note.blockId
      ? t(lang, 'taskTargetZh', { id: note.blockId })
      : t(lang, 'taskTargetNone')
  const lines = [
    `## ${index + 1}. ${info.folder}`,
    `- ${t(lang, 'taskTarget')}：${target}`,
    `- ${t(lang, 'taskEn')}：${sourceBlock ? sourceBlock.source.trim() : t(lang, 'taskMissingEn')}`,
    `- ${t(lang, 'taskZh')}：${zhBlock ? zhBlock.source.trim() : t(lang, 'taskMissingZh')}`,
    `- ${t(lang, 'taskQuote')}：${note.quote}`,
    `- ${t(lang, 'taskComment')}：${note.comment}`
  ]
  return lines.join('\n')
}

function splitFrontmatter(input: string): { data: { title: string; description: string }; body: string } {
  const data = { title: '', description: '' }
  if (!input.startsWith('---\n') && !input.startsWith('---\r\n')) return { data, body: input }
  const end = input.search(/\r?\n---\s*(?:\r?\n|$)/)
  if (end === -1) return { data, body: input }
  const raw = input.slice(input.indexOf('\n') + 1, end)
  raw.split(/\r?\n/).forEach((line) => {
    const match = /^(title|description|meta_description):\s*(.*)$/.exec(line)
    if (!match) return
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (match[1] === 'title') data.title = value
    if (match[1] === 'description' || (match[1] === 'meta_description' && !data.description)) data.description = value
  })
  const body = input.slice(end).replace(/^\r?\n---\s*/, '')
  return { data, body }
}

function blockFromNode(node: MdNode, id: string | null, depth: number, body: string): Block {
  if (node.type === 'heading') {
    return makeBlock({
      id,
      kind: 'heading',
      depth: (node.depth ?? 1) - 1,
      body,
      node,
      inlines: phrasing(node.children ?? []),
      text: plain(node)
    })
  }
  if (node.type === 'code') {
    return makeBlock({
      id,
      kind: 'code',
      depth,
      body,
      node,
      lang: node.lang ?? undefined,
      code: node.value ?? '',
      text: node.value ?? ''
    })
  }
  if (node.type === 'thematicBreak') {
    return makeBlock({ id, kind: 'hr', depth, body, node, text: '' })
  }
  if (node.type === 'table') {
    const rows = (node.children ?? []).map((row) => (row.children ?? []).map((cell) => phrasing(cell.children ?? [])))
    return makeBlock({
      id,
      kind: 'table',
      depth,
      body,
      node,
      header: rows.slice(0, 1),
      rows: rows.slice(1),
      text: plain(node)
    })
  }
  const onlyImage = node.type === 'paragraph' && node.children?.length === 1 && node.children[0].type === 'image'
  if (onlyImage && node.children?.[0]) {
    const image = node.children[0]
    return makeBlock({
      id,
      kind: 'image',
      depth,
      body,
      node,
      inlines: [{ type: 'image', url: safeUrl(image.url ?? '') ?? '', alt: image.alt ?? '' }],
      text: image.alt ?? ''
    })
  }
  return makeBlock({
    id,
    kind: 'paragraph',
    depth,
    body,
    node,
    inlines: phrasing(node.children ?? []),
    text: plain(node)
  })
}

function makeBlock(input: {
  id: string | null
  kind: Block['kind']
  depth: number
  body: string
  node: MdNode
  text: string
  marker?: string
  checked?: boolean | null
  lang?: string
  inlines?: Inline[]
  items?: Block[]
  header?: Inline[][][]
  rows?: Inline[][][]
  code?: string
}): Block {
  const source = slice(input.body, input.node)
  const key = input.id ? `id:${input.id}` : `auto:${hash(source)}:${input.kind}`
  return {
    id: input.id,
    key,
    kind: input.kind,
    depth: input.depth,
    text: input.text,
    source,
    marker: input.marker,
    checked: input.checked,
    lang: input.lang,
    inlines: input.inlines,
    items: input.items,
    header: input.header,
    rows: input.rows,
    code: input.code
  }
}

function splitGaps(blocks: Block[], anchors: string[]): Block[][] {
  const gaps: Block[][] = Array.from({ length: anchors.length + 1 }, () => [])
  const anchorSet = new Set(anchors)
  const seen = new Set<string>()
  let gap = 0
  for (const block of blocks) {
    if (block.id && anchorSet.has(block.id) && !seen.has(block.id)) {
      seen.add(block.id)
      gap = anchors.indexOf(block.id) + 1
      continue
    }
    gaps[Math.min(gap, gaps.length - 1)].push(block)
  }
  return gaps
}

function indexById(blocks: Block[]) {
  const map = new Map<string, Block>()
  blocks.forEach((block) => {
    if (block.id && !map.has(block.id)) map.set(block.id, block)
  })
  return map
}

function includesQuote(text: string, quote: string) {
  const needle = normalizeQuoteText(quote)
  return needle.length > 0 && normalizeQuoteText(text).includes(needle)
}

function findUnmarkedBlock(note: Note, blocks: Block[]): Block | undefined {
  const [located] = reconcileNotes([note], note.quoteLang === 'source' ? blocks : [], note.quoteLang === 'zh' ? blocks : null)
  return located.blockKey ? blocks.find((block) => block.key === located.blockKey) : undefined
}

/** Nested block markers still identify their own source, but highlight in the enclosing row. */
export function findBlockById(blocks: Block[], id: string): { block: Block; owner: Block } | undefined {
  for (const owner of blocks) {
    const visit = (block: Block): Block | undefined => block.id === id ? block : block.items?.map(visit).find((item) => item !== undefined)
    const block = visit(owner)
    if (block) return { block, owner }
  }
  return undefined
}

function slice(body: string, node: MdNode) {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start == null || end == null) return plain(node)
  return body.slice(start, end)
}

function commentId(node: MdNode) {
  if (node.type !== 'html' || !node.value) return null
  return BLOCK_RE.exec(node.value.trim())?.[1] ?? null
}

function stripLeadingMarker(node: MdNode) {
  const first = node.children?.[0]
  if (!first) return null
  if (commentId(first)) {
    const id = commentId(first)
    node.children?.shift()
    return id
  }
  if (first.type === 'paragraph') return stripLeadingMarker(first)
  return null
}

function isContent(node: MdNode) {
  return ['heading', 'paragraph', 'code', 'table', 'thematicBreak', 'blockquote'].includes(node.type)
}

function phrasing(nodes: MdNode[]): Inline[] {
  const result: Inline[] = []
  nodes.forEach((node) => {
    if (commentId(node)) return
    if (node.type === 'text') result.push({ type: 'text', value: node.value ?? '' })
    else if (node.type === 'inlineCode') result.push({ type: 'code', value: node.value ?? '' })
    else if (node.type === 'break') result.push({ type: 'break' })
    else if (node.type === 'strong') result.push({ type: 'strong', children: phrasing(node.children ?? []) })
    else if (node.type === 'emphasis') result.push({ type: 'em', children: phrasing(node.children ?? []) })
    else if (node.type === 'delete') result.push({ type: 'delete', children: phrasing(node.children ?? []) })
    else if (node.type === 'link') {
      const url = safeUrl(node.url ?? '')
      if (url) result.push({ type: 'link', url, children: phrasing(node.children ?? []) })
      else result.push(...phrasing(node.children ?? []))
    } else if (node.type === 'image') {
      const url = safeUrl(node.url ?? '')
      if (url) result.push({ type: 'image', url, alt: node.alt ?? '' })
    } else if (node.children) result.push(...phrasing(node.children))
  })
  return result
}

function plain(node: MdNode): string {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') return node.value ?? ''
  if (node.type === 'image') return node.alt ?? ''
  if (node.type === 'break') return '\n'
  const separator = node.type === 'tableRow' ? ' | ' : ['table', 'blockquote', 'list', 'listItem'].includes(node.type) ? '\n' : ''
  return (node.children ?? []).map((child) => plain(child)).join(separator)
}

/** Definitions are document-wide, including references used before their definition. */
function resolveReferences(tree: MdNode) {
  const definitions = new Map<string, MdNode>()
  const walk = (node: MdNode, callback: (item: MdNode) => void) => {
    callback(node)
    node.children?.forEach((child) => walk(child, callback))
  }
  const key = (identifier: string) => identifier.replace(/\s+/g, ' ').trim().toLowerCase()
  walk(tree, (node) => {
    if (node.type === 'definition' && node.identifier && !definitions.has(key(node.identifier))) definitions.set(key(node.identifier), node)
  })
  walk(tree, (node) => {
    if (node.type !== 'linkReference' && node.type !== 'imageReference') return
    const definition = definitions.get(key(node.identifier ?? ''))
    if (!definition) return
    node.type = node.type === 'linkReference' ? 'link' : 'image'
    node.url = definition.url
  })
}

/** A block marker followed by Markdown on the same line is a supported annotation,
 * not raw HTML. Parse only its trailing Markdown; other HTML remains inert. */
function expandInlineMarkers(tree: MdNode) {
  const shift = (node: MdNode, offset: number) => {
    if (node.position?.start.offset != null) node.position.start.offset += offset
    if (node.position?.end.offset != null) node.position.end.offset += offset
    node.children?.forEach((child) => shift(child, offset))
  }
  const visit = (parent: MdNode) => {
    parent.children = parent.children?.flatMap((node) => {
      if (node.type === 'html' && node.value) {
        const marker = /^<!--\s*block:([A-Za-z0-9_-]+)\s*-->/.exec(node.value)
        const rest = marker ? node.value.slice(marker[0].length) : ''
        if (marker && rest.trim()) {
          const children = (unified().use(remarkParse).use(remarkGfm).parse(rest) as MdNode).children ?? []
          const offset = (node.position?.start.offset ?? 0) + marker[0].length
          children.forEach((child) => { shift(child, offset); visit(child) })
          return [{ type: 'html', value: marker[0] } as MdNode, ...children]
        }
      }
      visit(node)
      return [node]
    })
  }
  visit(tree)
}

function safeUrl(url: string) {
  const value = url.trim()
  if (!value) return null
  const lower = value.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) return null
  return value
}

function hash(value: string) {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
