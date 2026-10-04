import { Fragment, useEffect, useId, useRef } from 'react'
import { Volume2, Pause, MessageSquarePlus, Languages } from 'lucide-react'
import type { Block, Inline, Note } from '@shared/types'
import { splitWords, wordKey } from '@shared/words'
import { useT } from './i18n'
import { sentenceForElement } from './sentence-context'
import { makeQuoteAnchor, normalizeQuoteText, resolveQuoteRange, type QuoteAnchor } from '@shared/quote-anchor'

export type LearnProps = {
  known: Set<string>
  active: string | null
  onWord: (word: string, rect: DOMRect, sentence?: string, occurrence?: string) => void
}

export function assetSrc(dir: string, url: string, version: number) {
  if (/^https?:\/\//i.test(url)) return url
  let decoded = url
  try {
    decoded = decodeURI(url)
  } catch {
    decoded = url
  }
  const base = decoded.startsWith('/') ? [] : dir.split(/[/\\]/)
  decoded.split(/[/\\]/).forEach((part) => {
    if (part === '..') base.pop()
    else if (part && part !== '.') base.push(part)
  })
  const absolute = decoded.startsWith('/') ? `/${base.join('/')}` : base.join('/')
  return `md-duck://asset/?path=${encodeURIComponent(absolute)}&v=${version}`
}

type InlineProps = {
  nodes: Inline[]
  dir: string
  version: number
  onImage: (src: string) => void
  learn?: LearnProps
}

export function Inlines({ nodes, dir, version, onImage, learn }: InlineProps) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === 'text') return learn ? <Words key={index} value={node.value} learn={learn} /> : <Fragment key={index}>{node.value}</Fragment>
        if (node.type === 'strong')
          return (
            <strong key={index}>
              <Inlines nodes={node.children} dir={dir} version={version} onImage={onImage} learn={learn} />
            </strong>
          )
        if (node.type === 'em')
          return (
            <em key={index}>
              <Inlines nodes={node.children} dir={dir} version={version} onImage={onImage} learn={learn} />
            </em>
          )
        if (node.type === 'delete')
          return (
            <del key={index}>
              <Inlines nodes={node.children} dir={dir} version={version} onImage={onImage} learn={learn} />
            </del>
          )
        if (node.type === 'code') return <code key={index}>{node.value}</code>
        if (node.type === 'break') return <br key={index} />
        if (node.type === 'link')
          return (
            <a
              key={index}
              href={node.url}
              title={node.url}
              onClick={(event) => {
                event.preventDefault()
                void window.api.openExternal(node.url)
              }}
            >
              <Inlines nodes={node.children} dir={dir} version={version} onImage={onImage} />
            </a>
          )
        if (node.type === 'image') {
          const src = assetSrc(dir, node.url, version)
          return <img key={index} src={src} alt={node.alt} onClick={() => onImage(src)} />
        }
        return null
      })}
    </>
  )
}

type BlockProps = {
  block: Block
  dir: string
  version: number
  lang: 'source' | 'zh'
  notes: Note[]
  flash: boolean
  speaking: boolean
  paused: boolean
  preparing?: boolean
  onImage: (src: string) => void
  onSpeak?: (block: Block) => void
  onAnnotate: (block: Block) => void
  onTranslate: (block: Block) => void
  learn?: LearnProps
}

export function BlockView(props: BlockProps) {
  const tr = useT()
  const { block, dir, version, lang, notes, flash, speaking, onImage } = props
  const openNotes = notes.filter(
    (note) => note.blockKey === block.key && note.quoteLang === lang && note.status !== 'resolved'
  )
  const dotClass = openNotes.some((note) => note.status === 'outdated') ? 'outdated' : ''
  const className = `blk ${kindClass(block)}${speaking ? ' speaking' : ''}${flash ? ' flash' : ''}`
  const hasText = block.text.trim().length > 0
  const speakLabel = speaking ? props.paused ? tr('resume') : props.preparing ? `${tr('preparing')} · ${tr('pause')}` : tr('pause') : tr('speakBlock')

  const tools = hasText && (
    <div className="tools">
      {props.onSpeak && canSpeak(block) && (
        <button
          title={speakLabel}
          aria-label={speakLabel}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => props.onSpeak?.(block)}
        >
          {speaking && !props.paused ? <Pause size={15} /> : <Volume2 size={15} />}
        </button>
      )}
      {lang === 'source' && isLatin(block.text) && (
        <button title={tr('translateBlock')} aria-label={tr('translateBlock')} onMouseDown={(e) => e.preventDefault()} onClick={() => props.onTranslate(block)}>
          <Languages size={15} />
        </button>
      )}
      <button title={tr('noteBlock')} aria-label={tr('noteBlock')} onMouseDown={(e) => e.preventDefault()} onClick={() => props.onAnnotate(block)}>
        <MessageSquarePlus size={15} />
      </button>
    </div>
  )

  const dot = openNotes.length > 0 && (
    <span className={`note-dot ${dotClass}`} title={tr('noteCount', { n: openNotes.length })} />
  )

  if (block.kind === 'heading') {
    const Tag = `h${Math.min(block.depth + 1, 4)}` as 'h1'
    return (
      <Tag className={`${className} h d${Math.min(block.depth, 3)}`} data-key={block.key} data-lang={lang}>
        {dot}
        <span className="text" data-note-text>
          <Inlines nodes={block.inlines ?? []} dir={dir} version={version} onImage={onImage} learn={props.learn} />
        </span>
        {tools}
      </Tag>
    )
  }

  return (
    <div
      className={className}
      data-key={block.key}
      data-lang={lang}
      style={block.kind === 'listItem' ? { marginLeft: `${block.depth * 1.4}em` } : undefined}
    >
      {dot}
      {renderBody(block, dir, version, onImage, props.learn)}
      {tools}
    </div>
  )
}

function renderBody(block: Block, dir: string, version: number, onImage: (src: string) => void, learn?: LearnProps, nested = false) {
  const contentAttrs = nested ? { 'data-note-part': true } : { 'data-note-text': true }
  const children = () => (block.items ?? []).map((item) => (
    <Fragment key={item.key}>{renderBody(item, dir, version, onImage, learn, true)}</Fragment>
  ))
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(block.depth + 1, 6)}` as 'h1'
      return <Tag className="md-part" {...contentAttrs}><Inlines nodes={block.inlines ?? []} dir={dir} version={version} onImage={onImage} learn={learn} /></Tag>
    }
    case 'image': {
      const image = block.inlines?.[0]
      if (image?.type !== 'image') return null
      const src = assetSrc(dir, image.url, version)
      return (
        <figure className="text md-part" {...contentAttrs}>
          <img src={src} alt={image.alt} onClick={() => onImage(src)} />
          {image.alt && <figcaption>{image.alt}</figcaption>}
        </figure>
      )
    }
    case 'code':
      return (
        <pre className="text md-part" {...contentAttrs}>
          <code>{block.code}</code>
        </pre>
      )
    case 'hr':
      return <hr className="md-part" {...contentAttrs} />
    case 'table':
      return (
        <table className="text md-part" {...contentAttrs}>
          <thead>
            {(block.header ?? []).map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <th key={c} data-note-cell>
                    <Inlines nodes={cell} dir={dir} version={version} onImage={onImage} learn={learn} />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {(block.rows ?? []).map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} data-note-cell>
                    <Inlines nodes={cell} dir={dir} version={version} onImage={onImage} learn={learn} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'blockquote': {
      const Tag = nested ? 'blockquote' : 'div'
      return <Tag className={`text md-part${nested ? ' md-quote' : ''}`} {...contentAttrs}>{children()}</Tag>
    }
    case 'listItem': {
      const content = (
        <>
          <span className={`marker ${block.checked != null ? 'task' : ''}`} aria-hidden data-note-ignore>
            {block.checked != null ? (block.checked ? '☑' : '☐') : block.marker}
          </span>
          <div className="text md-list-content" {...(nested ? {} : contentAttrs)}>
            {block.items?.length ? children() : <Inlines nodes={block.inlines ?? []} dir={dir} version={version} onImage={onImage} learn={learn} />}
          </div>
        </>
      )
      return nested ? <div className="md-part md-list-item" {...contentAttrs}>{content}</div> : content
    }
    default: {
      const Tag = nested ? 'p' : 'span'
      return (
        <Tag className="text md-part" {...contentAttrs}>
          <Inlines nodes={block.inlines ?? []} dir={dir} version={version} onImage={onImage} learn={learn} />
        </Tag>
      )
    }
  }
}

function kindClass(block: Block) {
  if (block.kind === 'listItem') return 'li'
  if (block.kind === 'blockquote') return 'quote'
  return block.kind
}

function Words({ value, learn }: { value: string; learn: LearnProps }) {
  const instanceId = useId()
  const pendingClick = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelPendingClick = () => {
    if (pendingClick.current !== null) clearTimeout(pendingClick.current)
    pendingClick.current = null
  }

  useEffect(() => cancelPendingClick, [])

  return (
    <>
      {splitWords(value).map((part, index) =>
        part.word ? (
          <span
            key={index}
            data-word-occurrence={`${instanceId}-${index}`}
            className={`lex${learn.known.has(wordKey(part.text)) ? ' known' : ''}${learn.active === `${instanceId}-${index}` ? ' on' : ''}`}
            onMouseDown={(event) => {
              if (event.detail > 1) cancelPendingClick()
            }}
            onClick={(event) => {
              cancelPendingClick()
              if (event.detail > 1 || window.getSelection()?.toString().trim()) return
              event.stopPropagation()
              const target = event.currentTarget
              const sentence = sentenceForElement(target)
              // Let a second click select the word without opening the dictionary.
              pendingClick.current = setTimeout(() => {
                pendingClick.current = null
                if (!target.isConnected || window.getSelection()?.toString().trim()) return
                learn.onWord(part.text, target.getBoundingClientRect(), sentence, `${instanceId}-${index}`)
              }, 350)
            }}
          >
            {part.text}
          </span>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        )
      )}
    </>
  )
}

export function canSpeak(block: Block) {
  return !['image', 'hr', 'code', 'table'].includes(block.kind) && block.text.trim().length > 1 && isLatin(block.text)
}

export function isLatin(text: string) {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return latin > 0 && cjk / (cjk + latin) < 0.2
}

type HighlightRegistryLike = { set(name: string, value: unknown): void; delete(name: string): void }
type HighlightCtor = new (...ranges: Range[]) => unknown

export function paintNoteHighlights(root: HTMLElement | null, notes: Note[], activeId: string | null) {
  const registry = (CSS as unknown as { highlights?: HighlightRegistryLike }).highlights
  const Ctor = (window as unknown as { Highlight?: HighlightCtor }).Highlight
  if (!root || !registry || !Ctor) return () => undefined
  const normal: Range[] = []
  const active: Range[] = []
  for (const note of notes) {
    if (!note.blockKey || (note.id !== activeId && (note.status === 'resolved' || note.status === 'orphaned'))) continue
    const selector = `[data-key="${CSS.escape(note.blockKey)}"][data-lang="${note.quoteLang}"] [data-note-text]`
    const host = root.querySelector(selector)
    const range = host ? findRange(host, note.quote, note.quoteAnchor) : null
    if (range) (note.id === activeId ? active : normal).push(range)
  }
  registry.set('md-note', new Ctor(...normal))
  registry.set('md-note-active', new Ctor(...active))
  return () => {
    registry.delete('md-note')
    registry.delete('md-note-active')
  }
}

type DomPoint = { node: Node; offset: number }
type TextProjection = { text: string; starts: DomPoint[]; ends: DomPoint[] }

/** Mirrors Markdown block/cell boundaries without including buttons or list markers. */
function textProjection(host: Element): TextProjection {
  const chars: string[] = []
  const starts: DomPoint[] = []
  const ends: DomPoint[] = []
  let whitespace: { start: DomPoint; end: DomPoint } | null = null
  const append = (char: string, start: DomPoint, end: DomPoint) => {
    if (/\s/.test(char)) {
      if (!whitespace) whitespace = { start, end }
      else whitespace.end = end
      return
    }
    if (whitespace && chars.length) {
      chars.push(' '); starts.push(whitespace.start); ends.push(whitespace.end)
    }
    whitespace = null
    chars.push(char); starts.push(start); ends.push(end)
  }
  const boundary = (node: Node, before: boolean): DomPoint => {
    const parent = node.parentNode
    if (!parent) return { node, offset: 0 }
    const index = Array.prototype.indexOf.call(parent.childNodes, node) as number
    return { node: parent, offset: index + (before ? 0 : 1) }
  }
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const text = (node as Text).data
      for (let i = 0; i < text.length; i += 1) append(text[i], { node, offset: i }, { node, offset: i + 1 })
      return
    }
    if (node.nodeType !== 1) return
    const element = node as Element
    if (element.hasAttribute('data-note-ignore')) return
    const separate = element.hasAttribute('data-note-part') || element.hasAttribute('data-note-cell') || element.tagName === 'BR'
    if (separate && element !== host) append('\n', boundary(element, true), boundary(element, true))
    if (element.hasAttribute('data-note-cell')) {
      const cells = Array.from(element.parentNode?.childNodes ?? []).filter((sibling) => sibling.nodeType === 1 && (sibling as Element).hasAttribute('data-note-cell'))
      if (cells.indexOf(element) > 0) {
        const point = boundary(element, true)
        // Preserve the established table quote representation without inserting visible glyphs.
        append('|', point, point); append(' ', point, point)
      }
    }
    if (element.tagName === 'IMG' && element.parentElement?.tagName !== 'FIGURE') {
      // Alt text participates in block.text, while an image itself has no text node.
      const alt = element.getAttribute('alt') ?? ''
      for (let i = 0; i < alt.length; i += 1) append(alt[i], boundary(element, true), boundary(element, false))
    } else element.childNodes.forEach(walk)
    if (separate && element !== host) append('\n', boundary(element, false), boundary(element, false))
  }
  walk(host)
  return { text: chars.join(''), starts, ends }
}

function noteTextHost(host: Element): Element | null {
  return host.hasAttribute('data-note-text') ? host : host.querySelector('[data-note-text]')
}

export function quoteSelectionForRange(block: Block, host: Element, range: Range): { quote: string; quoteAnchor: QuoteAnchor } | undefined {
  const textHost = noteTextHost(host)
  if (!textHost || !textHost.contains(range.startContainer) || !textHost.contains(range.endContainer)) return undefined
  const projection = textProjection(textHost)
  const included: number[] = []
  projection.starts.forEach((point, index) => {
    const end = projection.ends[index]
    if (range.comparePoint(point.node, point.offset) === 0 && range.comparePoint(end.node, end.offset) === 0) included.push(index)
  })
  if (!included.length) return undefined
  let start = included[0]
  let end = included[included.length - 1] + 1
  while (projection.text[start] === ' ') start += 1
  while (projection.text[end - 1] === ' ') end -= 1
  const quote = projection.text.slice(start, end)
  const canonical = normalizeQuoteText(block.text)
  if (canonical !== projection.text) {
    const domAnchor = makeQuoteAnchor(projection.text, start, end)
    const relocated = resolveQuoteRange(canonical, quote, domAnchor)
    if (!relocated) return undefined
    start = relocated.start; end = relocated.end
  }
  const quoteAnchor = makeQuoteAnchor(canonical, start, end)
  return quoteAnchor ? { quote, quoteAnchor } : undefined
}

export function quoteAnchorForRange(block: Block, host: Element, range: Range): QuoteAnchor | undefined {
  return quoteSelectionForRange(block, host, range)?.quoteAnchor
}

export function findRange(host: Element, quote: string, anchor?: QuoteAnchor): Range | null {
  const projection = textProjection(host)
  const located = resolveQuoteRange(projection.text, quote, anchor)
  if (!located) return null
  const start = projection.starts[located.start]
  const end = projection.ends[located.end - 1]
  if (!start || !end) return null
  const range = host.ownerDocument.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}
