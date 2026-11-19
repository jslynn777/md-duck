import { promises as fs } from 'node:fs'
import { posix, win32 } from 'node:path'
import { VOICES, type Preferences } from '../shared/types'

export type ReaderSettings = {
  root: string | null
  rootAliases?: string[]
  prefs: Preferences
  openPath: string | null
  scroll: Record<string, string>
  openRouterKey: string | null
}

type Platform = NodeJS.Platform
const paths = (platform: Platform) => platform === 'win32' ? win32 : posix
const fail = (): never => { throw new Error('ERR_SPACE_SETTINGS') }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const has = (value: object, key: PropertyKey) => Object.hasOwn(value, key)

function validPath(value: unknown, platform: Platform): value is string {
  return typeof value === 'string' && paths(platform).isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value)
}

/** Reject malformed saved values instead of silently replacing a user's last good preferences. */
function preferences(value: unknown): Partial<Preferences> & { openRouterKey?: string } {
  if (!object(value)) return fail()
  const choices: Record<string, readonly string[]> = {
    mode: ['source', 'zh', 'bilingual'], sidebarTab: ['files', 'outline'],
    librarySort: ['name-asc', 'name-desc', 'title', 'manual'], voice: VOICES, ui: ['en', 'zh']
  }
  for (const [key, allowed] of Object.entries(choices)) {
    if (has(value, key) && (typeof value[key] !== 'string' || !allowed.includes(value[key] as string))) return fail()
  }
  for (const key of ['fontSize', 'speed']) {
    if (has(value, key) && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || (value[key] as number) <= 0)) return fail()
  }
  if (has(value, 'sidebar') && typeof value.sidebar !== 'boolean') return fail()
  // An unfinished custom AI profile has no model yet; it must not prevent reading.
  if (has(value, 'model') && typeof value.model !== 'string') return fail()
  if (has(value, 'openRouterKey') && typeof value.openRouterKey !== 'string') return fail()
  return { ...value } as Partial<Preferences> & { openRouterKey?: string }
}

/** A root move uses directory boundaries and the host's path rules, without requiring the old drive. */
export function remapSpaceSettings(settings: ReaderSettings, newRoot: string, platform: Platform = process.platform): ReaderSettings {
  const path = paths(platform)
  if (!validPath(newRoot, platform)) return fail()
  const previous = settings.root
  const key = (value: string) => platform === 'win32' ? path.normalize(value).toLocaleLowerCase('en-US') : path.normalize(value)
  if (settings.rootAliases !== undefined && (!Array.isArray(settings.rootAliases) || !settings.rootAliases.every(alias => validPath(alias, platform)))) return fail()
  const aliasKeys = new Set<string>()
  const rootAliases = [...(settings.rootAliases ?? []), ...(previous && previous !== newRoot ? [previous] : [])].filter(alias => {
    if (alias === newRoot || aliasKeys.has(key(alias))) return false
    aliasKeys.add(key(alias))
    return true
  })
  const relocate = (value: string) => {
    if (!previous || !validPath(previous, platform) || !validPath(value, platform)) return value
    const suffix = path.relative(previous, value)
    if (suffix === '..' || suffix.startsWith(`..${path.sep}`) || path.isAbsolute(suffix)) return value
    return path.join(newRoot, suffix)
  }
  const entries = Object.entries(settings.scroll)
  const moving = new Map(entries.flatMap(([source]) => {
    const target = relocate(source)
    return target !== source ? [[source, target] as const] : []
  }))
  const owners = new Map<string, string[]>(), occupied = new Map<string, string[]>()
  for (const [source] of entries) occupied.set(key(source), [...(occupied.get(key(source)) ?? []), source])
  for (const [source, target] of moving) owners.set(key(target), [...(owners.get(key(target)) ?? []), source])
  for (const sources of owners.values()) if (sources.length > 1) for (const source of sources) moving.delete(source)
  // A blocked move retains its old key, which can block an earlier move as well.
  // Propagate that occupancy so no source is overwritten along a collision chain.
  let blocked: boolean
  do {
    blocked = false
    for (const [source, target] of moving) {
      if (occupied.get(key(target))?.some(owner => owner !== source && !moving.has(owner))) {
        moving.delete(source)
        blocked = true
      }
    }
  } while (blocked)
  const scroll = Object.fromEntries(entries.map(([source, position]) => [moving.get(source) ?? source, position]))
  return {
    ...settings,
    root: newRoot,
    ...(rootAliases.length || settings.rootAliases !== undefined ? { rootAliases } : {}),
    prefs: { ...settings.prefs },
    openPath: settings.openPath ? relocate(settings.openPath) : settings.openPath,
    scroll
  }
}

/** Read only: the caller commits after migration and AI credential handling succeed. */
export async function readReaderSettings(
  settingsFile: string,
  root: string | null,
  defaults: Preferences,
  defaultPrefs: Partial<Preferences> = {},
  platform: Platform = process.platform
): Promise<ReaderSettings> {
  if (root !== null && !validPath(root, platform)) return fail()
  let raw: string | null
  try { raw = await fs.readFile(settingsFile, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') raw = null
    else return fail()
  }
  let saved: Record<string, unknown> = {}
  if (raw !== null) {
    let value: unknown
    try { value = JSON.parse(raw) } catch { return fail() }
    if (!object(value)) return fail()
    saved = value
  }
  if (has(saved, 'root') && saved.root !== null && !validPath(saved.root, platform)) return fail()
  if (has(saved, 'rootAliases') && (!Array.isArray(saved.rootAliases) || !saved.rootAliases.every(alias => validPath(alias, platform)))) return fail()
  if (has(saved, 'openPath') && saved.openPath !== null && !validPath(saved.openPath, platform)) return fail()
  if (has(saved, 'openRouterKey') && saved.openRouterKey !== null && typeof saved.openRouterKey !== 'string') return fail()
  const savedPrefs = has(saved, 'prefs') ? preferences(saved.prefs) : {}
  const prefs = { ...preferences(defaults), ...preferences(defaultPrefs), ...savedPrefs } as Preferences & { openRouterKey?: string }
  delete prefs.openRouterKey
  const scroll = has(saved, 'scroll') ? saved.scroll : {}
  if (!object(scroll) || Object.entries(scroll).some(([path, value]) => !validPath(path, platform) || typeof value !== 'string')) return fail()
  const legacyKey = savedPrefs.openRouterKey
  const result: ReaderSettings = {
    root: typeof saved.root === 'string' ? saved.root : root,
    ...(has(saved, 'rootAliases') ? { rootAliases: [...saved.rootAliases as string[]] } : {}),
    prefs,
    openPath: typeof saved.openPath === 'string' ? saved.openPath : null,
    scroll: { ...scroll } as Record<string, string>,
    openRouterKey: has(saved, 'openRouterKey') ? saved.openRouterKey as string | null : legacyKey ? `raw:${legacyKey}` : null
  }
  if (root !== null) return remapSpaceSettings(result, root, platform)
  return { ...result, root: null }
}
