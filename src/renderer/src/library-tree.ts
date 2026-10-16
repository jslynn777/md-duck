import type { LibraryFolder } from '../../shared/library'
import type { LibraryEntry } from '../../shared/types'

export type LibraryArticleNode = { kind: 'article'; path: string; entry: LibraryEntry; relativePath: string; bundlePath?: string }
export type LibraryFolderNode = { kind: 'folder'; path: string; name: string; relativePath: string; archived: boolean; children: LibraryNode[]; count: number }
export type LibraryNode = LibraryArticleNode | LibraryFolderNode

const auxiliaryNames = new Set(['assets', 'images', 'img', 'attachments', 'node_modules'])

export function libraryPath(path: string) {
  const normalized = path.replace(/\\/g, '/')
  if (/^[a-z]:\/*$/i.test(normalized)) return `${normalized.slice(0, 2)}/`
  return normalized.replace(/\/+$/, '') || '/'
}

export function libraryParent(path: string) {
  const normalized = libraryPath(path)
  const index = normalized.lastIndexOf('/')
  if (index < 0) return normalized
  return normalized.slice(0, index) || '/'
}

export function libraryName(path: string) {
  return libraryPath(path).split('/').pop() || '/'
}

function pathKey(path: string) {
  const normalized = libraryPath(path)
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized
}

export function sameLibraryPath(a: string, b: string) { return pathKey(a) === pathKey(b) }

export function libraryRelative(root: string, path: string) {
  const base = libraryPath(root)
  const normalized = libraryPath(path)
  if (sameLibraryPath(base, normalized)) return ''
  return pathKey(normalized).startsWith(`${pathKey(base).replace(/\/$/, '')}/`) ? normalized.slice(base.replace(/\/$/, '').length + 1) : normalized
}

export function libraryWithin(parent: string, child: string) {
  return sameLibraryPath(parent, child) || pathKey(child).startsWith(`${pathKey(parent).replace(/\/$/, '')}/`)
}

export function auxiliaryLibraryFolder(root: string, path: string) {
  return libraryRelative(root, path).split('/').some((name) => name.startsWith('.') || auxiliaryNames.has(name.toLowerCase()))
}

/** Presentation follows the real directory structure; it never mutates article order or files. */
export function buildLibraryTree(root: string, entries: LibraryEntry[], folders: LibraryFolder[], archived = false): LibraryNode[] {
  const actual = entries.filter((entry) => !!entry.archived === archived && libraryWithin(root, entry.path))
  const rootNode: LibraryFolderNode = { kind: 'folder', path: root, name: libraryName(root), relativePath: '', archived, count: 0, children: [] }
  const byPath = new Map<string, LibraryFolderNode>([[pathKey(root), rootNode]])
  const ensure = (path: string): LibraryFolderNode => {
    const key = pathKey(path)
    const found = byPath.get(key)
    if (found) return found
    const parent = libraryParent(path)
    // Only descendants of the opened library may become tree nodes.
    if (!libraryWithin(root, path) || sameLibraryPath(path, parent)) return rootNode
    const node: LibraryFolderNode = { kind: 'folder', path, name: libraryName(path), relativePath: libraryRelative(root, path), archived, count: 0, children: [] }
    byPath.set(key, node)
    ensure(parent).children.push(node)
    return node
  }
  for (const folder of folders) {
    if (!!folder.archived !== archived || !libraryWithin(root, folder.path)) continue
    // An auxiliary directory containing an actual article remains discoverable.
    if (auxiliaryLibraryFolder(root, folder.path) && !actual.some((entry) => libraryWithin(folder.path, entry.path))) continue
    ensure(folder.path).archived = folder.archived
  }
  for (const entry of actual) ensure(libraryParent(entry.path)).children.push({ kind: 'article', path: entry.path, entry, relativePath: libraryRelative(root, entry.path) })
  const order = new Map(actual.map((entry, index) => [pathKey(entry.path), index]))
  const tidy = (folder: LibraryFolderNode): number => {
    let count = 0
    folder.children = folder.children.map((child): LibraryNode => {
      if (child.kind === 'article') { count++; return child }
      count += tidy(child)
      if (libraryRelative(root, child.path) !== 'Archive' && child.children.length === 1 && child.children[0].kind === 'article' && sameLibraryPath(libraryParent(child.children[0].path), child.path) && /^article\.(md|markdown)$/i.test(libraryName(child.children[0].path))) {
        return { ...child.children[0], bundlePath: child.path }
      }
      return child
    })
    folder.children.sort((a, b) => {
      if (a.kind === 'folder' && b.kind === 'folder') return a.name.localeCompare(b.name, undefined, { numeric: true })
      if (a.kind === 'folder') return -1
      if (b.kind === 'folder') return 1
      return (order.get(pathKey(a.path)) ?? 0) - (order.get(pathKey(b.path)) ?? 0)
    })
    folder.count = count
    return count
  }
  tidy(rootNode)
  return archived ? rootNode.children.flatMap((node) => node.kind === 'folder' && libraryRelative(root, node.path) === 'Archive' ? node.children : [node]) : rootNode.children
}

export function filterLibraryTree(nodes: LibraryNode[], query: string): LibraryNode[] {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return nodes
  return nodes.flatMap((node): LibraryNode[] => {
    if (node.kind === 'article') return `${node.entry.title}\n${node.relativePath}`.toLocaleLowerCase().includes(term) ? [node] : []
    if (`${node.name}\n${node.relativePath}`.toLocaleLowerCase().includes(term)) return [node]
    const children = filterLibraryTree(node.children, query)
    return children.length ? [{ ...node, children, count: countLibraryArticles(children) }] : []
  })
}

export function countLibraryArticles(nodes: LibraryNode[]): number {
  return nodes.reduce((total, node) => total + (node.kind === 'article' ? 1 : countLibraryArticles(node.children)), 0)
}

/** Exclude article bundles, assets and the moving directory's own subtree from folder choices. */
export function libraryDestinations(root: string, entries: LibraryEntry[], folders: LibraryFolder[], movingPath?: string) {
  const bundleFolders = new Set<string>()
  const collect = (nodes: LibraryNode[]) => nodes.forEach((node) => {
    if (node.kind === 'folder') collect(node.children)
    else if (node.bundlePath) bundleFolders.add(pathKey(node.bundlePath))
  })
  collect(buildLibraryTree(root, entries, folders, false))
  collect(buildLibraryTree(root, entries, folders, true))
  return [root, ...folders.filter((folder) => !folder.archived && libraryWithin(root, folder.path) && !sameLibraryPath(root, folder.path)
    && !auxiliaryLibraryFolder(root, folder.path) && !bundleFolders.has(pathKey(folder.path)))
    .map((folder) => folder.path)]
    .filter((path, index, all) => all.findIndex((candidate) => sameLibraryPath(candidate, path)) === index)
    .filter((path) => !movingPath || !libraryWithin(movingPath, path))
    .sort((a, b) => sameLibraryPath(a, root) ? -1 : sameLibraryPath(b, root) ? 1 : libraryRelative(root, a).localeCompare(libraryRelative(root, b), undefined, { numeric: true }))
}

export function parseArticleTitles(value: string) {
  return value.split(/\r?\n/).map((title) => title.trim()).filter(Boolean)
}


/** IPC errors can contain transport prefixes; never expose internal error codes in the reader. */
export function libraryErrorCopy(reason: unknown, ui: 'zh' | 'en') {
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : ''
  const key = message.match(/LIBRARY_[A-Z_]+/)?.[0] ?? (/\b(?:EACCES|EPERM)\b/.test(message) ? 'PERMISSION' : /\bENOENT\b/.test(message) ? 'LIBRARY_ARTICLE_MISSING' : '')
  const copy: Record<string, [string, string]> = {
    LIBRARY_DESTINATION_EXISTS: ['目标位置已有同名文件或文件夹。请换一个名称或位置，现有文件未被覆盖。', 'A file or folder already exists at the destination. Choose another name or location; existing files were not overwritten.'],
    LIBRARY_MOVE_FOLDER_WITH_ASSETS: ['这篇文章使用了同目录的图片或相对链接。请移动整个所属文件夹，以保留这些关联。', 'This article uses nearby images or relative links. Move its containing folder to keep those references together.'],
    LIBRARY_OPEN_ARTICLE_BEFORE_MOVE: ['请先打开这篇文章，让现有批注完成迁移，再移动或重命名。', 'Open this article first so its existing comments can be migrated, then move or rename it.'],
    LIBRARY_METADATA_CORRUPT: ['文章库管理记录无法读取，已暂停整理操作。文章仍可阅读，请先保留并检查文章库中的管理记录。', 'The library’s management records cannot be read. Organizing is paused; articles can still be read. Preserve and inspect the library’s management records first.'],
    LIBRARY_ARTICLE_METADATA_CORRUPT: ['这篇文章的批注或译文关联记录无法读取，暂未执行整理。请先检查或恢复相关记录。', 'The article’s comment or translation records cannot be read. No organizing change was made. Check or restore those records first.'],
    LIBRARY_RECOVERY_REQUIRED: ['上一次文件操作需要恢复，已暂停新的整理操作。请保留当前文件和管理记录，避免手动覆盖。', 'An earlier file operation needs recovery. Further organizing is paused. Preserve the current files and management records without overwriting them.'],
    LIBRARY_TRANSLATION_BUSY: ['正在生成译文，请等翻译完成或取消翻译后再整理文件。', 'A translation is in progress. Wait for it to finish or cancel it before organizing files.'],
    LIBRARY_PATH_UNSAFE: ['这个位置无法安全整理。请选择文章库内的真实文件或文件夹，避免符号链接。', 'This location cannot be organized safely. Choose a real file or folder within the library, without symbolic links.'],
    LIBRARY_RELOCATION_REVIEW_REQUIRED: ['检测到外部文件移动，但无法可靠确认文章关联。已有记录仍保留，请检查文件位置后再整理。', 'An external move was detected, but the article association could not be confirmed. Existing records are preserved. Check the file locations before organizing.'],
    LIBRARY_MISSING_ARTICLES: ['部分文章已移走或暂时不可用，已有批注和进度记录仍保留。', 'Some articles have moved away or are unavailable. Their existing comments and progress records are preserved.'],
    LIBRARY_SOURCE_CHANGED: ['文件刚刚被其他程序修改或移动。本次操作已停止，请稍后重试。', 'Another program just changed or moved the file. This operation was stopped; try again shortly.'],
    LIBRARY_FOLDER_MISSING: ['文件夹已移走或不存在，请选择现有文件夹。', 'This folder has moved or no longer exists. Choose an existing folder.'],
    LIBRARY_ARTICLE_MISSING: ['文件已移走或不存在，请等待列表刷新后重试。', 'This file has moved or no longer exists. Wait for the list to refresh, then try again.'],
    LIBRARY_TRANSLATION_MISSING: ['关联的译文文件已移走或不存在。请先恢复译文或检查关联，再整理文章。', 'The associated translation has moved or is missing. Restore it or check the association before organizing this article.'],
    LIBRARY_INVALID_NAME: ['名称不适用于本地文件系统，请换一个名称，避免斜杠或保留字符。', 'This name is not valid for local files. Choose another name without slashes or reserved characters.'],
    LIBRARY_INVALID_TITLES: ['请每行填写一个有效标题，一次最多 50 篇。', 'Enter one valid title per line, up to 50 articles at once.'],
    LIBRARY_INVALID_STAGE: ['这个进度标记无效，请重新选择。', 'This progress value is invalid. Choose it again.'],
    LIBRARY_ROOT_IMMOVABLE: ['不能移动文章库根目录，请选择其中的文章或文件夹。', 'The library root cannot be moved. Choose an article or folder inside it.'],
    LIBRARY_ALREADY_ARCHIVED: ['这个项目已经归档，可在“已归档”中查看。', 'This item is already archived. Find it in Archived.'],
    LIBRARY_NOT_ARCHIVED: ['这个项目当前没有归档，请刷新列表后重试。', 'This item is not archived. Refresh the list and try again.'],
    LIBRARY_RESTORE_LOCATION_UNKNOWN: ['无法确认归档前的位置。请使用“移动到…”选择恢复位置。', 'The original location is unknown. Use Move to… to choose where to restore it.'],
    LIBRARY_RESTORE_FOLDER_MISSING: ['归档前的上级文件夹已不存在。请先恢复该文件夹，或使用“移动到…”选择新位置。', 'The original parent folder no longer exists. Restore that folder first, or use Move to… to choose a new location.'],
    LIBRARY_MOVE_INTO_SELF: ['不能把文件夹移入它自己或它的子文件夹，请选择其他位置。', 'A folder cannot be moved into itself or one of its subfolders. Choose another location.'],
    LIBRARY_UNAVAILABLE: ['暂时无法读取文章库，请检查文件夹是否仍可访问。', 'The library cannot be read right now. Check that its folder is still accessible.'],
    PERMISSION: ['没有权限更改这些文件，请检查本地文件夹权限后重试。', 'These files could not be changed due to permissions. Check the local folder permissions and try again.']
  }
  return copy[key]?.[ui === 'zh' ? 0 : 1] ?? (ui === 'zh' ? '操作未完成，请检查文件位置和权限后重试。' : 'The operation could not be completed. Check the file location and permissions, then try again.')
}
