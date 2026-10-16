import type { LibraryRelocation } from './library'

function exactRelocations(relocations: readonly LibraryRelocation[]): Map<string, string> {
  const result = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const { from, to } of relocations) {
    if (!from || !to || ambiguous.has(from)) continue
    if (result.has(from) && result.get(from) !== to) {
      result.delete(from)
      ambiguous.add(from)
    } else result.set(from, to)
  }
  return result
}

/** Apply an exact source-to-destination mapping once, without prefix or content guesses. */
export function relocatePath(path: string, relocations: readonly LibraryRelocation[]): string {
  return exactRelocations(relocations).get(path) ?? path
}

/**
 * Move keyed data from the original snapshot. Conflicting destinations retain
 * their source records, including any preceding move blocked by that record.
 * This allows swaps, while never overwriting a different reading position/draft.
 */
export function relocatePathRecords<T>(records: Record<string, T>, relocations: readonly LibraryRelocation[]): Record<string, T> {
  const targets = exactRelocations(relocations)
  const entries = Object.entries(records)
  const moving = new Map(entries.flatMap(([path]) => {
    const target = targets.get(path)
    return target && target !== path ? [[path, target] as const] : []
  }))
  const owners = new Map<string, string[]>()
  for (const [path, target] of moving) owners.set(target, [...(owners.get(target) ?? []), path])
  for (const paths of owners.values()) {
    if (paths.length > 1) for (const path of paths) moving.delete(path)
  }
  // A blocked move leaves its original key occupied. Propagate this backwards
  // until all remaining destinations are either vacant or moved away together.
  let blocked: boolean
  do {
    blocked = false
    for (const [path, target] of moving) {
      if (Object.hasOwn(records, target) && !moving.has(target)) {
        moving.delete(path)
        blocked = true
      }
    }
  } while (blocked)
  return Object.fromEntries(entries.map(([path, value]) => [moving.get(path) ?? path, value]))
}

export function relocateScroll(scroll: Record<string, string>, relocations: readonly LibraryRelocation[]): Record<string, string> {
  return relocatePathRecords(scroll, relocations)
}
