export type LibraryView = { query: string; archived: boolean; changedOnly: boolean; collapsed: string[] }
export const emptyLibraryView = (): LibraryView => ({ query: '', archived: false, changedOnly: false, collapsed: [] })
const prefix = 'md-duck:library-view:v1:'

function relativeFolder(root: string, folder: string): string | null {
  const base = root.replace(/\\/g, '/').replace(/\/$/, '')
  const path = folder.replace(/\\/g, '/')
  const windows = /^[a-z]:\//i.test(base) || base.startsWith('//')
  const normalBase = windows ? base.toLowerCase() : base
  const normalPath = windows ? path.toLowerCase() : path
  return normalPath.startsWith(normalBase + '/') ? path.slice(base.length + 1) : null
}

export function readLibraryView(storage: Pick<Storage, 'getItem'>, space: string, root: string): LibraryView {
  try {
    const raw = storage.getItem(prefix + space)
    if (!raw) return emptyLibraryView()
    const value = JSON.parse(raw)
    if (value?.version !== 1) return emptyLibraryView()
    const separator = root.includes('\\') ? '\\' : '/'
    const base = root.replace(/[/\\]$/, '')
    return {
      query: typeof value.query === 'string' ? value.query.slice(0, 1000) : '',
      archived: value.archived === true,
      changedOnly: value.changedOnly === true,
      collapsed: Array.isArray(value.collapsed) ? value.collapsed.filter((path: unknown): path is string => typeof path === 'string' && !!path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => part === '.' || part === '..' || part === '')).slice(0, 2000).map((path: string) => base + separator + path.split('/').join(separator)) : []
    }
  } catch { return emptyLibraryView() }
}

export function writeLibraryView(storage: Pick<Storage, 'setItem'>, space: string, root: string, view: LibraryView): boolean {
  try {
    storage.setItem(prefix + space, JSON.stringify({ version: 1, query: view.query, archived: view.archived, changedOnly: view.changedOnly,
      collapsed: view.collapsed.map(path => relativeFolder(root, path)).filter((path): path is string => path !== null) }))
    return true
  } catch { return false }
}
