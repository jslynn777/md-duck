type LocalPath = { root: string; parts: string[] }

function splitPath(value: string): LocalPath {
  const path = value.replaceAll('\\', '/')
  const drive = /^([a-z]:)\/+(.+)?$/i.exec(path)
  if (drive) return { root: `${drive[1]}/`, parts: (drive[2] ?? '').split('/') }
  const share = /^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(path)
  if (share) return { root: `//${share[1]}/${share[2]}/`, parts: (share[3] ?? '').split('/') }
  return { root: path.startsWith('/') ? '/' : '', parts: path.split('/') }
}

function normalizeParts(parts: string[]) {
  const normalized: string[] = []
  for (const part of parts) {
    if (part === '..') normalized.pop()
    else if (part && part !== '.') normalized.push(part)
  }
  return normalized
}

function localDestination(url: string): string | null {
  if (/^file:/i.test(url)) {
    try {
      const file = new URL(url)
      // Match file URL separator rules; never reinterpret an encoded separator
      // as a different local path. The main process checks the library boundary.
      if (file.username || file.password || file.port || /%2f|%5c/i.test(file.pathname)) return null
      const path = decodeURIComponent(file.pathname)
      if (file.hostname && file.hostname !== 'localhost') return `//${file.hostname}${path}`
      return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path
    } catch {
      return null
    }
  }
  // A drive letter is a path, while other schemes are neither local assets nor
  // approved remote images. Drive-relative paths depend on hidden OS state.
  if (/^[a-z]:/i.test(url) && !/^[a-z]:[/\\]/i.test(url)) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(url) && !/^[a-z]:[/\\]/i.test(url)) return null
  try { return decodeURIComponent(url) } catch { return url }
}

export function assetSrc(dir: string, url: string, version: number): string {
  if (/^https?:\/\//i.test(url)) return url
  const destination = localDestination(url)
  if (!destination || destination.includes('\0')) return ''
  const base = splitPath(dir)
  const target = splitPath(destination)
  // A rooted Windows path (\images\photo.png) keeps the current drive/share.
  const root = target.root === '/' && base.root !== '/' && base.root
    ? base.root : target.root || base.root
  const parts = normalizeParts(target.root ? target.parts : [...normalizeParts(base.parts), ...target.parts])
  const absolute = root + parts.join('/')
  return `md-duck://asset/?path=${encodeURIComponent(absolute)}&v=${version}`
}
