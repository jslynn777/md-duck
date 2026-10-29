import { describe, expect, it } from 'vitest'
import type { LibraryFolder } from '../../shared/library'
import type { LibraryEntry } from '../../shared/types'
import { buildLibraryTree, countChangedLibraryArticles, countLibraryArticles, countLibraryChangeIssues, filterLibraryTree, libraryDestinations, libraryErrorCopy, libraryName, libraryParent, libraryRelative, libraryWithin, normalizeLibrarySort, parseArticleTitles, sameLibraryPath, type LibraryNode } from './library-tree'

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

  it('separates archive view and preserves source order when manual sorting is selected', () => {
    const entries = [entry('/library/series/b.md', 'B'), entry('/library/Archive/old/article.md', 'Old', true), entry('/library/series/a.md', 'A')]
    const folders = [folder('/library/series'), folder('/library/Archive', true), folder('/library/Archive/old', true)]
    expect(articles(buildLibraryTree('/library', entries, folders, false, 'manual'))).toEqual(['/library/series/b.md', '/library/series/a.md'])
    expect(articles(buildLibraryTree('/library', entries, folders, true))).toEqual(['/library/Archive/old/article.md'])
    expect(buildLibraryTree('/library', entries, folders, true)[0]).toMatchObject({ kind: 'article', bundlePath: '/library/Archive/old' })
  })

  it('defaults to natural file and bundle names instead of H1 titles or stored manual order', () => {
    const entries = [entry('/library/10-finish/article.md', 'A finish'), entry('/library/2-review/article.md', 'Z review'), entry('/library/1-start/article.md', 'M start')]
    const folders = [folder('/library/10-finish'), folder('/library/2-review'), folder('/library/1-start')]
    const original = structuredClone(entries)
    expect(articles(buildLibraryTree('/library', entries, folders))).toEqual(['/library/1-start/article.md', '/library/2-review/article.md', '/library/10-finish/article.md'])
    expect(entries).toEqual(original)
    expect(articles(buildLibraryTree('/library', entries, folders, false, 'manual'))).toEqual(entries.map((item) => item.path))
  })

  it('sorts names descending while retaining folders before article rows at every depth', () => {
    const entries = [entry('/library/2-series/part2.md'), entry('/library/2-series/part10.md'), entry('/library/1-series/intro.md'), entry('/library/9-loose.md'), entry('/library/10-loose.md')]
    const folders = [folder('/library/1-series'), folder('/library/2-series')]
    const nodes = buildLibraryTree('/library', entries, folders, false, 'name-desc')
    expect(nodes.map((node) => node.kind === 'folder' ? node.name : libraryName(node.path))).toEqual(['2-series', '1-series', '10-loose.md', '9-loose.md'])
    expect(articles(nodes).slice(0, 2)).toEqual(['/library/2-series/part10.md', '/library/2-series/part2.md'])
  })

  it('offers explicit title sorting without rewriting the file names or saved order', () => {
    const entries = [entry('/library/first.md', 'Zebra'), entry('/library/last.md', 'Apple 10'), entry('/library/middle.md', 'Apple 2')]
    const original = structuredClone(entries)
    expect(articles(buildLibraryTree('/library', entries, [], false, 'title'))).toEqual(['/library/middle.md', '/library/last.md', '/library/first.md'])
    expect(entries).toEqual(original)
    expect(articles(buildLibraryTree('/library', entries, [], false, 'manual'))).toEqual(entries.map((item) => item.path))
  })

  it('keeps the selected natural order in filtered results and archived bundles', () => {
    const entries = [entry('/library/Archive/10-chapter/article.md', 'Chapter 1', true), entry('/library/Archive/2-chapter/article.md', 'Chapter 2', true)]
    const folders = [folder('/library/Archive', true), folder('/library/Archive/10-chapter', true), folder('/library/Archive/2-chapter', true)]
    const nodes = buildLibraryTree('/library', entries, folders, true)
    expect(articles(filterLibraryTree(nodes, 'chapter'))).toEqual(['/library/Archive/2-chapter/article.md', '/library/Archive/10-chapter/article.md'])
    expect(articles(buildLibraryTree('/library', entries, folders, true, 'name-desc'))).toEqual(entries.map((item) => item.path))
  })

  it('uses the same natural bundle order for Windows paths', () => {
    const entries = [entry('C:\\资料\\10-结束\\article.md', 'A'), entry('c:/资料/2-审阅/article.md', 'Z')]
    const folders = [folder('C:\\资料\\10-结束'), folder('C:\\资料\\2-审阅')]
    expect(articles(buildLibraryTree('C:\\资料', entries, folders))).toEqual([entries[1].path, entries[0].path])
  })

  it('falls back to name order for old or invalid saved preferences', () => {
    expect(normalizeLibrarySort(undefined)).toBe('name-asc')
    expect(normalizeLibrarySort('outdated-value')).toBe('name-asc')
    expect(normalizeLibrarySort('name-desc')).toBe('name-desc')
    expect(normalizeLibrarySort('title')).toBe('title')
    expect(normalizeLibrarySort('manual')).toBe('manual')
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

  it('counts changed articles through nested and collapsed bundle folders without changing name order', () => {
    const changed = (path: string, translation = false): LibraryEntry => ({ ...entry(path), changes: { changed: true, source: !translation, translation } })
    const entries = [changed('/library/series/10-last/article.md'), entry('/library/series/2-middle/article.md'), changed('/library/series/1-first/article.md', true)]
    const folders = [folder('/library/series'), ...entries.map((item) => folder(libraryParent(item.path)))]
    const nodes = buildLibraryTree('/library', entries, folders)
    expect(nodes[0]).toMatchObject({ kind: 'folder', count: 3, changedCount: 2, changeIssueCount: 0 })
    expect(countChangedLibraryArticles(nodes)).toBe(2)
    expect(articles(nodes)).toEqual(['/library/series/1-first/article.md', '/library/series/2-middle/article.md', '/library/series/10-last/article.md'])
    const filtered = filterLibraryTree(nodes, 'series', true)
    expect(articles(filtered)).toEqual(['/library/series/1-first/article.md', '/library/series/10-last/article.md'])
    expect(filtered[0]).toMatchObject({ count: 2, changedCount: 2 })
    expect(articles(nodes)).toHaveLength(3)
  })

  it('combines the changed filter with title search and omits unchanged empty directories', () => {
    const entries: LibraryEntry[] = [
      { ...entry('/library/series/a.md', 'First draft'), changes: { changed: true, source: true, translation: false } },
      { ...entry('/library/series/b.md', 'Second draft'), changes: { changed: true, source: false, translation: true } },
      entry('/library/series/c.md', 'Third draft')
    ]
    const nodes = buildLibraryTree('/library', entries, [folder('/library/series'), folder('/library/empty')])
    expect(articles(filterLibraryTree(nodes, 'second', true))).toEqual(['/library/series/b.md'])
    expect(filterLibraryTree(nodes, 'second', true)[0]).toMatchObject({ count: 1, changedCount: 1 })
    expect(filterLibraryTree(nodes, 'empty', true)).toEqual([])
    expect(filterLibraryTree(nodes, 'third', true)).toEqual([])
    expect(countLibraryArticles(filterLibraryTree(nodes, '', true))).toBe(2)
  })

  it('keeps changed counts scoped to active or archived articles and preserves manual order', () => {
    const entries: LibraryEntry[] = [
      { ...entry('/library/b.md'), changes: { changed: true, source: true, translation: false } },
      { ...entry('/library/a.md'), changes: { changed: true, source: false, translation: true } },
      { ...entry('/library/Archive/old/article.md', 'Old', true), changes: { changed: true, source: true, translation: true } }
    ]
    const folders = [folder('/library/Archive', true), folder('/library/Archive/old', true)]
    const active = buildLibraryTree('/library', entries, folders, false, 'manual')
    const archived = buildLibraryTree('/library', entries, folders, true)
    expect(countChangedLibraryArticles(active)).toBe(2)
    expect(countChangedLibraryArticles(archived)).toBe(1)
    expect(articles(filterLibraryTree(active, '', true))).toEqual(['/library/b.md', '/library/a.md'])
    expect(articles(filterLibraryTree(archived, '', true))).toEqual(['/library/Archive/old/article.md'])
  })

  it('preserves check failures separately from confirmed changes, including in collapsed folders', () => {
    const entries: LibraryEntry[] = [
      { ...entry('/library/series/unknown.md', 'Unknown'), changes: { changed: false, source: false, translation: false, issue: 'UNREADABLE_BASELINE' } },
      { ...entry('/library/series/changed.md', 'Changed'), changes: { changed: true, source: true, translation: false } }
    ]
    const nodes = buildLibraryTree('/library', entries, [folder('/library/series')])
    expect(nodes[0]).toMatchObject({ count: 2, changedCount: 1, changeIssueCount: 1 })
    expect(countLibraryChangeIssues(nodes)).toBe(1)
    const found = filterLibraryTree(nodes, 'unknown')
    expect(countChangedLibraryArticles(found)).toBe(0)
    expect(countLibraryChangeIssues(found)).toBe(1)
    expect(articles(filterLibraryTree(nodes, '', true))).toEqual(['/library/series/changed.md'])
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
