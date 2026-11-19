import { promises as fs } from 'node:fs'
import { posix, win32 } from 'node:path'
import { parseDocument } from '../shared/markdown'
import type { Block, Inline } from '../shared/types'

export const PREVIEW_READ_LIMIT = 128 * 1024
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i

/** Resolve only local destinations; authorization is still checked against the real file below. */
export function previewImagePath(source: string, destination: string, platform: NodeJS.Platform = process.platform): string | null {
  const paths = platform === 'win32' ? win32 : posix
  if (!paths.isAbsolute(source) || !destination || /[\x00-\x1f\x7f]/.test(destination)) return null
  let target = destination
  if (/^file:/i.test(target)) {
    try {
      const url = new URL(target)
      if (url.username || url.password || url.port || /%2f|%5c/i.test(url.pathname)) return null
      target = decodeURIComponent(url.pathname)
      if (url.hostname && url.hostname !== 'localhost') {
        if (platform !== 'win32') return null
        target = `//${url.hostname}${target}`
      } else if (platform === 'win32' && /^\/[a-z]:\//i.test(target)) target = target.slice(1)
    } catch { return null }
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(target) && !(platform === 'win32' && /^[a-z]:[/\\]/i.test(target))) return null
    if (platform !== 'win32' && (target.startsWith('//') || target.startsWith('\\'))) return null
    try { target = decodeURIComponent(target) } catch { return null }
  }
  if (/[\x00-\x1f\x7f]/.test(target) || !IMAGE_EXTENSION.test(target) ||
    (/^[a-z][a-z\d+.-]*:/i.test(target) && !(platform === 'win32' && /^[a-z]:[/\\]/i.test(target)))) return null
  return paths.resolve(paths.dirname(source), target)
}

function imageDestinations(blocks: Block[]): string[] {
  const found: string[] = []
  const inlines = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === 'image') found.push(node.url)
      else if ('children' in node) inlines(node.children)
    }
  }
  const visit = (items: Block[]) => {
    for (const block of items) {
      if (block.inlines) inlines(block.inlines)
      if (block.items) visit(block.items)
      for (const row of [...(block.header ?? []), ...(block.rows ?? [])]) for (const cell of row) inlines(cell)
    }
  }
  visit(blocks)
  return found
}

/** A cover is a small, bounded preview of the current article, never a remote image fetch. */
export async function readSpacePreview(source: string, options: {
  scope?: string
  version: number
  isAllowed: (path: string) => Promise<boolean>
}): Promise<{ text: string; images: string[] }> {
  const empty = { text: '', images: [] as string[] }
  try {
    const canonicalSource = await fs.realpath(source)
    if (!await options.isAllowed(canonicalSource)) return empty
    const handle = await fs.open(canonicalSource, 'r')
    let markdown: string
    try {
      if (!(await handle.stat()).isFile()) return empty
      const buffer = Buffer.alloc(PREVIEW_READ_LIMIT)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      markdown = buffer.subarray(0, bytesRead).toString('utf8')
    } finally { await handle.close() }
    const text = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '').replace(/<!--[^]*?-->/g, '')
      .replace(/^#{1,6}\s+.*$/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#*`>]/g, '').trim().slice(0, 400)
    if (!options.scope) return { text, images: [] }
    const images: string[] = [], seen = new Set<string>()
    for (const destination of imageDestinations(parseDocument(markdown, '').blocks).slice(0, 64)) {
      const candidate = previewImagePath(source, destination)
      if (!candidate) continue
      const real = await fs.realpath(candidate).catch(() => null)
      if (!real || seen.has(real) || !await options.isAllowed(real)) continue
      if (!(await fs.stat(real).catch(() => null))?.isFile()) continue
      seen.add(real)
      const url = new URL('md-duck://asset/')
      url.searchParams.set('path', real)
      url.searchParams.set('v', String(options.version))
      url.searchParams.set('scope', options.scope)
      images.push(url.href)
      if (images.length === 3) break
    }
    return { text, images }
  } catch { return empty }
}
