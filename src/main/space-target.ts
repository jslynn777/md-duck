import { promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { isPathInsideRoot } from './allowed-path'
import { normalizeSpaceArticlePath, validSpaceId, type SpaceTarget } from '../shared/spaces'

export function parseSpaceOpenUrl(input: string): SpaceTarget {
  let url: URL
  try { url = new URL(input) } catch { throw new Error('ERR_SPACE_TARGET') }
  if (url.protocol !== 'mdduck:' || url.hostname !== 'open' || url.username || url.password || url.port || url.hash || (url.pathname !== '' && url.pathname !== '/')) throw new Error('ERR_SPACE_TARGET')
  const keys = [...url.searchParams.keys()]
  if (keys.some((key) => key !== 'space' && key !== 'path') || new Set(keys).size !== keys.length) throw new Error('ERR_SPACE_TARGET')
  const spaceId = url.searchParams.get('space')
  if (!validSpaceId(spaceId)) throw new Error('ERR_SPACE_TARGET')
  const rawPath = url.searchParams.get('path')
  return { spaceId, ...(rawPath === null ? {} : { relativePath: normalizeSpaceArticlePath(rawPath) }) }
}

/** Ignore Electron's own arguments, but reject ambiguous combinations of our targeting arguments. */
export function parseSpaceTargetArgs(args: readonly string[]): SpaceTarget | null {
  let space: string | undefined
  let file: string | undefined
  let link: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (/^mdduck:/i.test(arg)) {
      if (link !== undefined) throw new Error('ERR_SPACE_TARGET')
      link = arg
    } else if (arg === '--mdduck-space' || arg.startsWith('--mdduck-space=')) {
      if (space !== undefined) throw new Error('ERR_SPACE_TARGET')
      space = arg === '--mdduck-space' ? args[++i] : arg.slice('--mdduck-space='.length)
      if (!space || space.startsWith('--')) throw new Error('ERR_SPACE_TARGET')
    } else if (arg === '--mdduck-file' || arg.startsWith('--mdduck-file=')) {
      if (file !== undefined) throw new Error('ERR_SPACE_TARGET')
      file = arg === '--mdduck-file' ? args[++i] : arg.slice('--mdduck-file='.length)
      if (!file || file.startsWith('--')) throw new Error('ERR_SPACE_TARGET')
    }
  }
  if (link !== undefined) {
    if (space !== undefined || file !== undefined) throw new Error('ERR_SPACE_TARGET')
    return parseSpaceOpenUrl(link)
  }
  if (space === undefined && file === undefined) return null
  if (!validSpaceId(space)) throw new Error('ERR_SPACE_TARGET')
  return { spaceId: space, ...(file === undefined ? {} : { relativePath: normalizeSpaceArticlePath(file) }) }
}

export type SpaceLaunchResult = { target: SpaceTarget | null; invalid: boolean }
export type SpaceLaunchData = { mdduckLaunch: SpaceLaunchResult & { version: 1 } }

/** Chromium may reorder second-instance argv; preserve the parsed original target separately. */
export function createSpaceLaunchData(args: readonly string[]): SpaceLaunchData {
  try {
    return { mdduckLaunch: { version: 1, target: parseSpaceTargetArgs(args), invalid: false } }
  } catch {
    return { mdduckLaunch: { version: 1, target: null, invalid: true } }
  }
}

/** An absent envelope supports older launchers; a malformed envelope must never fall back. */
export function parseSpaceLaunchData(data: unknown): SpaceLaunchResult | undefined {
  if (!data || typeof data !== 'object' || !('mdduckLaunch' in data)) return undefined
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  const envelope = data.mdduckLaunch
  if (!record(data) || !record(envelope) || envelope.version !== 1 || typeof envelope.invalid !== 'boolean' ||
    Object.keys(envelope).some(key => !['version', 'target', 'invalid'].includes(key))) throw new Error('ERR_SPACE_TARGET')
  if (envelope.target === null) return { target: null, invalid: envelope.invalid }
  if (envelope.invalid || !record(envelope.target) || !validSpaceId(envelope.target.spaceId) ||
    Object.keys(envelope.target).some(key => key !== 'spaceId' && key !== 'relativePath')) throw new Error('ERR_SPACE_TARGET')
  const target: SpaceTarget = { spaceId: envelope.target.spaceId }
  if ('relativePath' in envelope.target) {
    if (typeof envelope.target.relativePath !== 'string') throw new Error('ERR_SPACE_TARGET')
    target.relativePath = normalizeSpaceArticlePath(envelope.target.relativePath)
  }
  return { target, invalid: false }
}

/** Resolve again at use time so a symlink cannot redirect a targeted article outside its space. */
export async function resolveSpaceArticle(root: string, relativePath: string): Promise<string> {
  if (!isAbsolute(root)) throw new Error('ERR_SPACE_TARGET')
  const path = join(root, ...normalizeSpaceArticlePath(relativePath).split('/'))
  if (!(await isPathInsideRoot(path, root))) throw new Error('ERR_SPACE_TARGET')
  const stat = await fs.stat(path).catch(() => null)
  if (!stat?.isFile()) throw new Error('ERR_SPACE_DOCUMENT_MISSING')
  return fs.realpath(path)
}
