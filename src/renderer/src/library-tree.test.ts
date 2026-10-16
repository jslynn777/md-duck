import { describe, expect, it } from 'vitest'
import type { LibraryFolder } from '../../shared/library'
import type { LibraryEntry } from '../../shared/types'
import { buildLibraryTree, countLibraryArticles, filterLibraryTree, libraryDestinations, libraryErrorCopy, libraryName, libraryParent, libraryRelative, libraryWithin, parseArticleTitles, sameLibraryPath, type LibraryNode } from './library-tree'

const entry = (path: string, title = path, archived = false): LibraryEntry => ({ path, title, folder: '.', zhPath: null, archived })
const folder = (path: string, archived = false): LibraryFolder => ({ path, name: libraryName(path), parentPath: libraryParent(path), archived })
function articles(nodes: LibraryNode[]): string[] { return nodes.flatMap((node) => node.kind === 'article' ? [node.path] : articles(node.children)) }

describe('real folder library tree', () => {
  it('keeps nested real folders and empty directories while counting descendant articles once', () => {
    const nodes = buildLibraryTree('/library', [entry('/library/series/part2/topic.md', 'Topic'), entry('/library/loose.md', 'Loose')], [folder('/library/series'), folder('/library/series/part2'), folder('/library/empty')])
    expect(nodes.map((node) => node.kind === 'folder' ? node.name : node.entry.title)).toEqual(['empty', 'series', 'Loose'])
    expect(nodes[0]).toMatchObject({ kind: 'folder', count: 0, children: [] })
    expect(nodes[1]).toMatchObject({ kind: 'folder', count: 1 })
    expect(countLibraryArticles(nodes)).toBe(2)
    expect(articles(nodes)).toEqual(['/library/series/part2/topic.md', '/library/loose.md'])
  })

  it('presents a single article.md folder as one article, keeping its actual source path', () => {
    const nodes = buildLibraryTree('/library', [entry('/library/series/first/article.md', 'First')], [folder('/library/series'), folder('/library/series/first'), folder('/library/series/first/assets')])
    expect(nodes[0]).toMatchObject({ kind: 'folder', name: 'series', count: 1, children: [{ kind: 'article', path: '/library/series/first/article.md', bundlePath: '/library/series/first' }] })
  })

  it('does not collapse folders with another document or independent subdirectory', () => {
    const nodes = buildLibraryTree('/library', [entry('/library/series/article.md'), entry('/library/series/other.md')], [folder('/library/series'), folder('/library/series/empty')])
    expect(nodes[0].kind).toBe('folder')
    expect(nodes[0]).toMatchObject({ count: 2 })
    const withEmpty = buildLibraryTree('/library', [entry('/library/series/article.md')], [folder('/library/series'), folder('/library/series/empty')])
    expect(withEmpty[0].kind).toBe('folder')
  })

  it('hides auxiliary folders without hiding an actual article stored inside one', () => {
    const nodes = buildLibraryTree('/library', [entry('/library/images/readme.md', 'Image notes')], [folder('/library/assets'), folder('/library/.md-duck'), folder('/library/images'), folder('/library/images/thumbnails')])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kind: 'folder', name: 'images', count: 1 })
    expect(articles(nodes)).toEqual(['/library/images/readme.md'])
  })

  it('separates archive view and keeps source order among article siblings', () => {
    const entries = [entry('/library/series/b.md', 'B'), entry('/library/Archive/old/article.md', 'Old', true), entry('/library/series/a.md', 'A')]
    const folders = [folder('/library/series'), folder('/library/Archive', true), folder('/library/Archive/old', true)]
    expect(articles(buildLibraryTree('/library', entries, folders))).toEqual(['/library/series/b.md', '/library/series/a.md'])
    expect(articles(buildLibraryTree('/library', entries, folders, true))).toEqual(['/library/Archive/old/article.md'])
    expect(buildLibraryTree('/library', entries, folders, true)[0]).toMatchObject({ kind: 'article', bundlePath: '/library/Archive/old' })
  })

  it('rejects paths outside the opened folder and prefix lookalikes', () => {
    const nodes = buildLibraryTree('/library', [entry('/library/a.md'), entry('/library-old/b.md'), entry('/outside/c.md')], [folder('/outside')])
    expect(articles(nodes)).toEqual(['/library/a.md'])
    expect(libraryWithin('/library', '/library-old')).toBe(false)
  })

  it('filters titles and relative paths while retaining matching ancestors and empty folder matches', () => {
    const nodes = buildLibraryTree('/library', [entry('/library/series/apple.md', 'Fresh Apple'), entry('/library/series/pear.md', 'Pear')], [folder('/library/series'), folder('/library/empty')])
    const titleResult = filterLibraryTree(nodes, ' FRESH ')
    expect(articles(titleResult)).toEqual(['/library/series/apple.md'])
    expect(titleResult[0]).toMatchObject({ kind: 'folder', name: 'series', count: 1 })
    expect(articles(filterLibraryTree(nodes, 'series/pear'))).toEqual(['/library/series/pear.md'])
    expect(articles(filterLibraryTree(nodes, 'series'))).toHaveLength(2)
    expect(filterLibraryTree(nodes, 'empty')[0]).toMatchObject({ kind: 'folder', count: 0 })
    expect(filterLibraryTree(nodes, 'unknown')).toEqual([])
    expect(filterLibraryTree(nodes, '  ')).toBe(nodes)
  })

  it('keeps Windows and network paths together without case duplicates', () => {
    const root = 'C:\\资料'
    const nodes = buildLibraryTree(root, [entry('c:/资料/系列/article.md', 'Title')], [folder('C:\\资料\\系列')])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kind: 'article', bundlePath: 'C:\\资料\\系列', relativePath: '系列/article.md' })
    expect(sameLibraryPath('C:\\资料\\系列', 'c:/资料/系列/')).toBe(true)
    expect(sameLibraryPath('/Library', '/library')).toBe(false)
    expect(libraryRelative('\\\\server\\share', '\\\\SERVER\\share\\文章\\a.md')).toBe('文章/a.md')
  })

  it('offers real destination folders excluding bundles, auxiliary directories, archives, and own descendants', () => {
    const entries = [entry('/library/bundle/article.md')]
    const folders = [folder('/library/bundle'), folder('/library/bundle/assets'), folder('/library/target'), folder('/library/target/child'), folder('/library/Archive', true), folder('/outside')]
    expect(libraryDestinations('/library', entries, folders)).toEqual(['/library', '/library/target', '/library/target/child'])
    expect(libraryDestinations('/library', entries, folders, '/library/target')).toEqual(['/library'])
  })

  it('parses one draft title per nonempty line without altering title punctuation', () => {
    expect(parseArticleTitles('  First: an introduction\r\n\n 第二篇 \r\nThird?')).toEqual(['First: an introduction', '第二篇', 'Third?'])
  })

  it('supports drive-root libraries without treating their own files as outside paths', () => {
    expect(libraryWithin('C:\\', 'c:/article.md')).toBe(true)
    expect(libraryRelative('C:\\', 'c:/series/article.md')).toBe('series/article.md')
    expect(articles(buildLibraryTree('C:\\', [entry('c:/article.md')], []))).toEqual(['c:/article.md'])
  })

  it('turns IPC-prefixed errors into actionable localized messages without exposing internal codes', () => {
    const raw = new Error("Error invoking remote method 'library:manage': Error: LIBRARY_DESTINATION_EXISTS")
    expect(libraryErrorCopy(raw, 'zh')).toContain('同名')
    expect(libraryErrorCopy(raw, 'en')).toContain('already exists')
    expect(libraryErrorCopy('LIBRARY_MOVE_FOLDER_WITH_ASSETS', 'zh')).toContain('整个所属文件夹')
    expect(libraryErrorCopy('LIBRARY_METADATA_CORRUPT', 'en')).toContain('Organizing is paused')
    expect(libraryErrorCopy('LIBRARY_RELOCATION_REVIEW_REQUIRED', 'zh')).toContain('已有记录仍保留')
    expect(libraryErrorCopy(new Error('EPERM: secret/private/path'), 'en')).toContain('permissions')
    expect(libraryErrorCopy(new Error('LIBRARY_UNKNOWN_BACKEND_DETAIL'), 'zh')).not.toContain('LIBRARY')
    expect(libraryErrorCopy(new Error('secret/private/path'), 'en')).not.toContain('secret')
  })

})
