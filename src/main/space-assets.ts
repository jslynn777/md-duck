import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml'
}

export type SpaceAsset = { path: string; type: string }
type AssetPermission = (path: string) => Promise<boolean>

/** Local image access belongs to the requesting reader, never the union of open libraries. */
export function createSpaceAssetRegistry() {
  const permissions = new Map<string, AssetPermission>()

  function register(isAllowed: AssetPermission): string {
    const scope = randomUUID()
    permissions.set(scope, isAllowed)
    return scope
  }

  function remove(scope: string) { permissions.delete(scope) }

  async function resolve(input: string): Promise<SpaceAsset | null> {
    try {
      const url = new URL(input)
      if (url.protocol !== 'md-duck:' || url.hostname !== 'asset' || url.username || url.password || url.port || url.hash ||
        (url.pathname !== '/' && url.pathname !== '')) return null
      const keys = [...url.searchParams.keys()]
      if (new Set(keys).size !== keys.length || keys.some(key => !['scope', 'path', 'v'].includes(key))) return null
      const scope = url.searchParams.get('scope')
      const path = url.searchParams.get('path')
      const version = url.searchParams.get('v')
      if (!scope || !path || !isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path) ||
        (version !== null && !/^\d{1,16}$/.test(version))) return null
      const type = IMAGE_TYPES[extname(path).toLowerCase()]
      const isAllowed = permissions.get(scope)
      if (!type || !isAllowed) return null

      // Read the resolved file after authorization. Missing files keep their
      // requested path so the protocol handler can return its ordinary 404.
      const target = await realpath(path).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? path : null)
      if (!target || !await isAllowed(target) || permissions.get(scope) !== isAllowed) return null
      return { path: target, type }
    } catch {
      // A disappeared root or failed permission check grants no access.
      return null
    }
  }

  return { register, remove, resolve }
}
