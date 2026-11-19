import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, posix, win32 } from 'node:path'
import { createSettingsWriter } from './settings-store'
import { validSpaceId, type SpaceRecord, type SpaceRegistry } from '../shared/spaces'

type Platform = NodeJS.Platform
type StoreOptions = { userData: string; platform?: Platform }

const emptyRegistry = (): SpaceRegistry => ({ version: 1, activeSpaceId: null, spaces: [] })
const paths = (platform: Platform) => platform === 'win32' ? win32 : posix
const copy = <T>(value: T): T => structuredClone(value)

/** Use the platform's path rules; Windows roots must not become two spaces by casing alone. */
export function spaceRootKey(root: string, platform: Platform = process.platform): string {
  const path = paths(platform)
  if (typeof root !== 'string' || !path.isAbsolute(root) || /[\x00-\x1f\x7f]/.test(root)) throw new Error('ERR_SPACE_FOLDER')
  const normalized = path.normalize(root)
  const volumeRoot = path.parse(normalized).root
  const withoutTrailing = normalized.length > volumeRoot.length ? normalized.replace(/[\\/]+$/, '') : normalized
  return platform === 'win32' ? withoutTrailing.toLocaleLowerCase('en-US') : withoutTrailing
}

export function spaceRootsOverlap(left: string, right: string, platform: Platform = process.platform): boolean {
  const path = paths(platform)
  const a = spaceRootKey(left, platform)
  const b = spaceRootKey(right, platform)
  const inside = (root: string, candidate: string) => {
    const relative = path.relative(root, candidate)
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  }
  return inside(a, b) || inside(b, a)
}

function nameFor(root: string, platform: Platform): string {
  return (paths(platform).basename(root) || root).slice(0, 120)
}

function cleanName(name: string): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('ERR_SPACE_NAME')
  return name.trim()
}

function validateRegistry(value: unknown, platform: Platform): SpaceRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ERR_SPACES_CORRUPT')
  const registry = value as SpaceRegistry
  if (registry.version !== 1 || !Array.isArray(registry.spaces) || registry.spaces.length > 1000 || (registry.removed !== undefined && (!Array.isArray(registry.removed) || registry.removed.length > 10000))) throw new Error('ERR_SPACES_CORRUPT')
  const ids = new Set<string>()
  const roots: string[] = []
  for (const [index, record] of [...registry.spaces, ...(registry.removed ?? [])].entries()) {
    if (!record || typeof record !== 'object' || !validSpaceId(record.id) || ids.has(record.id) || typeof record.root !== 'string' || typeof record.name !== 'string' || typeof record.createdAt !== 'string' || typeof record.lastOpenedAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.lastOpenedAt))) throw new Error('ERR_SPACES_CORRUPT')
    try {
      cleanName(record.name)
      spaceRootKey(record.root, platform)
      if (index < registry.spaces.length && roots.some((root) => spaceRootsOverlap(root, record.root, platform))) throw new Error('overlap')
    } catch { throw new Error('ERR_SPACES_CORRUPT') }
    ids.add(record.id)
    if (index < registry.spaces.length) roots.push(record.root)
  }
  if (registry.activeSpaceId !== null && (!validSpaceId(registry.activeSpaceId) || !registry.spaces.some((space) => space.id === registry.activeSpaceId))) throw new Error('ERR_SPACES_CORRUPT')
  return copy(registry)
}

async function optionalText(path: string): Promise<string | null> {
  try { return await fs.readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** New migration files are exclusive, so retries never overwrite another recovery copy. */
async function writeExclusive(path: string, text: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const handle = await fs.open(path, 'wx', 0o600)
  try { await handle.writeFile(text); await handle.sync() } finally { await handle.close() }
}

export function createSpacesStore(options: StoreOptions) {
  const platform = options.platform ?? process.platform
  const registryPath = join(options.userData, 'spaces.json')
  const legacyPath = join(options.userData, 'settings.json')
  const writer = createSettingsWriter(registryPath)
  let registry: SpaceRegistry | null = null
  let loading: Promise<SpaceRegistry> | undefined
  let pending: Promise<unknown> = Promise.resolve()

  function settingsPath(id: string): string {
    if (!validSpaceId(id)) throw new Error('ERR_SPACE_NOT_FOUND')
    return join(options.userData, 'spaces', id, 'settings.json')
  }

  async function canonicalRoot(root: string): Promise<string> {
    spaceRootKey(root, platform)
    const stat = await fs.stat(root).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('ERR_SPACE_FOLDER')
    return fs.realpath(root)
  }

  async function migrate(): Promise<SpaceRegistry> {
    const raw = await optionalText(legacyPath)
    const next = emptyRegistry()
    if (raw !== null) {
      let legacy: Record<string, unknown>
      try {
        const value: unknown = JSON.parse(raw)
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
        legacy = value as Record<string, unknown>
        if (legacy.root !== undefined && legacy.root !== null && typeof legacy.root !== 'string') throw new Error('invalid')
        if (typeof legacy.root === 'string') spaceRootKey(legacy.root, platform)
      } catch { throw new Error('ERR_SPACES_LEGACY_CORRUPT') }
      const backup = join(options.userData, 'settings.pre-spaces.json')
      const existingBackup = await optionalText(backup)
      if (existingBackup === null) await writeExclusive(backup, raw)
      else if (existingBackup !== raw) await writeExclusive(join(options.userData, `settings.pre-spaces.${randomUUID()}.json`), raw)
      if (typeof legacy.root === 'string') {
        let root: string
        try { root = await canonicalRoot(legacy.root) } catch {
          // A disconnected drive remains a recoverable space instead of losing its saved state.
          root = paths(platform).normalize(legacy.root)
        }
        const now = new Date().toISOString()
        const record: SpaceRecord = { id: randomUUID(), name: nameFor(root, platform), root, createdAt: now, lastOpenedAt: now }
        await writeExclusive(settingsPath(record.id), raw)
        next.spaces.push(record)
        next.activeSpaceId = record.id
      }
    }
    // The original settings and the migration copy are durable before the registry points at them.
    await writer.write(next)
    return next
  }

  async function load(): Promise<SpaceRegistry> {
    if (registry) return copy(registry)
    if (!loading) {
      loading = (async () => {
        const raw = await optionalText(registryPath)
        let next: SpaceRegistry
        if (raw === null) next = await migrate()
        else {
          let value: unknown
          try { value = JSON.parse(raw) } catch { throw new Error('ERR_SPACES_CORRUPT') }
          next = validateRegistry(value, platform)
        }
        registry = next
        return copy(next)
      })()
    }
    try { return copy(await loading) } catch (error) { loading = undefined; throw error }
  }

  function snapshot(): SpaceRegistry {
    if (!registry) throw new Error('ERR_SPACES_NOT_READY')
    return copy(registry)
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.catch(() => undefined).then(async () => { await load(); return operation() })
    pending = next
    return next
  }

  async function commit(next: SpaceRegistry): Promise<void> {
    await writer.write(next)
    registry = next
  }

  function find(next: SpaceRegistry, id: string): SpaceRecord {
    const record = next.spaces.find((space) => space.id === id)
    if (!record) throw new Error('ERR_SPACE_NOT_FOUND')
    return record
  }

  function checkOverlap(next: SpaceRegistry, root: string, exceptId?: string): void {
    if (next.spaces.some((space) => space.id !== exceptId && spaceRootsOverlap(space.root, root, platform))) throw new Error('ERR_SPACE_ROOT_OVERLAP')
  }

  function add(root: string, name?: string): Promise<SpaceRecord> {
    return enqueue(async () => {
      const canonical = await canonicalRoot(root)
      const next = snapshot()
      const existing = next.spaces.find((space) => spaceRootKey(space.root, platform) === spaceRootKey(canonical, platform))
      if (existing) return copy(existing)
      checkOverlap(next, canonical)
      const now = new Date().toISOString()
      const removed = [...(next.removed ?? [])].reverse().find((space) => spaceRootKey(space.root, platform) === spaceRootKey(canonical, platform))
      const record: SpaceRecord = removed
        ? { ...removed, root: canonical, name: name === undefined ? removed.name : cleanName(name), lastOpenedAt: now }
        : { id: randomUUID(), name: name === undefined ? nameFor(canonical, platform) : cleanName(name), root: canonical, createdAt: now, lastOpenedAt: now }
      if (removed) next.removed = next.removed?.filter((space) => space.id !== removed.id)
      next.spaces.push(record)
      if (!next.activeSpaceId) next.activeSpaceId = record.id
      await commit(next)
      return copy(record)
    })
  }

  function activate(id: string): Promise<SpaceRecord> {
    return enqueue(async () => {
      const next = snapshot()
      const record = find(next, id)
      record.lastOpenedAt = new Date().toISOString()
      next.activeSpaceId = id
      await commit(next)
      return copy(record)
    })
  }

  function rename(id: string, name: string): Promise<SpaceRecord> {
    return enqueue(async () => {
      const next = snapshot()
      const record = find(next, id)
      record.name = cleanName(name)
      await commit(next)
      return copy(record)
    })
  }

  function relocate(id: string, root: string): Promise<SpaceRecord> {
    return enqueue(async () => {
      const next = snapshot()
      const record = find(next, id)
      const canonical = await canonicalRoot(root)
      checkOverlap(next, canonical, id)
      record.root = canonical
      await commit(next)
      return copy(record)
    })
  }

  function remove(id: string): Promise<void> {
    return enqueue(async () => {
      const next = snapshot()
      const record = find(next, id)
      next.spaces = next.spaces.filter((space) => space.id !== id)
      next.removed = [...(next.removed ?? []).filter((space) => space.id !== id), record]
      if (next.activeSpaceId === id) next.activeSpaceId = [...next.spaces].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))[0]?.id ?? null
      await commit(next)
      // Removing a shortcut never removes local content or this space's saved reading data.
    })
  }

  return { load, snapshot, add, activate, rename, relocate, remove, settingsPath, flush: async () => { await pending; await writer.flush() } }
}
