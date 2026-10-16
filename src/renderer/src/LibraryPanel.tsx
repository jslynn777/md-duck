import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Archive, ChevronDown, ChevronRight, Folder, MoreHorizontal, Plus, Search, X } from 'lucide-react'
import type { ArticleStage, LibraryChange, LibraryCommand, LibraryFolder } from '../../shared/library'
import type { LibraryEntry, UiLang } from '../../shared/types'
import { buildLibraryTree, filterLibraryTree, libraryDestinations, libraryErrorCopy, libraryName, libraryParent, libraryRelative, parseArticleTitles, sameLibraryPath, type LibraryNode } from './library-tree'
import './library-panel.css'

type Props = {
  root: string | null
  entries: LibraryEntry[]
  folders: LibraryFolder[]
  issue?: string
  ui: UiLang
  currentPath: string | null
  onOpen: (path: string) => void
  onFileMenu: (path: string, position: { x: number; y: number }) => void
  onChange: (change: LibraryChange) => void
  onError: (message: string) => void
}

type Target = { documentId?: string; fileIdentity?: string; path: string; title: string; folder: boolean; archived: boolean; bundlePath?: string; stage?: ArticleStage }
type Menu = { target: Target | null; x: number; y: number }
type Editor = { kind: 'create-folder' | 'create-articles' | 'rename' | 'move' | 'archive' | 'restore' | 'stage'; target: Target }
const stages: ArticleStage[] = ['unmarked', 'writing', 'review', 'done']

const words = {
  zh: {
    search: '搜索标题或路径', all: '全部', archived: '已归档', add: '新建', folder: '新建文件夹', articles: '批量新建文章',
    noRoot: '先打开一个本地文件夹', noArticles: '还没有文章，可以新建或放入 Markdown 文件。', noArchived: '没有已归档的文章或文件夹', noMatch: '没有找到匹配的文章或文件夹',
    menu: '管理', rename: '重命名', move: '移动到…', archive: '归档', restore: '恢复归档', stage: '标记进度', up: '上移', down: '下移',
    fileActions: '文件位置与打开方式…', cancel: '取消', save: '保存', busy: '正在处理…', close: '关闭',
    name: '名称', titles: '文章标题，每行一篇', titleHint: '一次最多 50 篇。每篇创建独立文件夹，内含 article.md，方便一起保存译文和图片。',
    destination: '目标文件夹', location: '本地位置', root: '文章库根目录',
    realFolder: '会在本地磁盘创建真实文件夹，文件管理器中也能看到。', realArticles: '将在这个本地文件夹中创建 Markdown 草稿。',
    realRename: '会更改本地名称，并保留关联的译文、批注和阅读位置。', realMove: '会移动本地文件。文章的译文、批注、图片和阅读位置会一起保留。',
    realArchive: '会移入文章库的归档文件夹，保留原文、译文、批注和阅读位置。之后可在“已归档”中恢复。',
    realRestore: '会将本地文件移回归档前的位置。若原位置已被占用，会提示处理。',
    realStage: '进度保存在文章库中，不会修改正文。',
    unmarked: '未标记', writing: '写作中', review: '待审阅', done: '已定稿',
    tooMany: '一次最多新建 50 篇文章，请减少标题数量。', required: '请填写名称。', noTitles: '至少填写一个文章标题。', noDestination: '请选择目标文件夹。',
    failure: '操作失败，请检查路径和文件权限后重试。', create: '创建', articleCount: '篇文章', folderCount: '篇',
    archiveTitle: '归档这篇文章？', archiveFolder: '归档这个文件夹？', restoreTitle: '恢复归档？', pathHint: '文件夹与本地磁盘同步',
    invalidName: '名称不能包含路径分隔符，也不能是 . 或 ..。', noDestinations: '没有可用的目标文件夹。', duplicateTitles: '标题有重复，请分别命名后再创建。'
  },
  en: {
    search: 'Search titles or paths', all: 'All', archived: 'Archived', add: 'New', folder: 'New folder', articles: 'Create multiple articles',
    noRoot: 'Open a local folder first', noArticles: 'No articles yet. Create drafts or add Markdown files.', noArchived: 'No archived articles or folders', noMatch: 'No matching articles or folders',
    menu: 'Manage', rename: 'Rename', move: 'Move to…', archive: 'Archive', restore: 'Restore', stage: 'Set progress', up: 'Move up', down: 'Move down',
    fileActions: 'File location and open options…', cancel: 'Cancel', save: 'Save', busy: 'Working…', close: 'Close',
    name: 'Name', titles: 'Article titles, one per line', titleHint: 'Up to 50 at once. Each article gets its own folder with article.md, keeping translations and images together.',
    destination: 'Destination folder', location: 'Local location', root: 'Library root',
    realFolder: 'This creates a real folder on disk, visible in your file manager.', realArticles: 'Markdown drafts will be created in this local folder.',
    realRename: 'This changes the local name and preserves associated translations, comments, and reading positions.', realMove: 'This moves local files while preserving each article’s translation, comments, images, and reading position.',
    realArchive: 'This moves items into the library’s archive folder, preserving source files, translations, comments, and reading positions. You can restore them from Archived.',
    realRestore: 'This moves local files back to their previous location. You will be notified if that location is occupied.',
    realStage: 'Progress is saved with the library without changing the article text.',
    unmarked: 'Unmarked', writing: 'Writing', review: 'To review', done: 'Final',
    tooMany: 'Create up to 50 articles at once. Remove some titles to continue.', required: 'Enter a name.', noTitles: 'Enter at least one article title.', noDestination: 'Choose a destination folder.',
    failure: 'The operation failed. Check the path and file permissions, then try again.', create: 'Create', articleCount: 'articles', folderCount: 'articles',
    archiveTitle: 'Archive this article?', archiveFolder: 'Archive this folder?', restoreTitle: 'Restore from archive?', pathHint: 'Folders stay in sync with local files',
    invalidName: 'Names cannot contain path separators or be “.” or “..”.', noDestinations: 'No destination folders available.', duplicateTitles: 'Some titles are repeated. Give each article a different title.'
  }
}

export function LibraryPanel({ root, entries, folders, issue, ui, currentPath, onOpen, onFileMenu, onChange, onError }: Props) {
  const copy = words[ui]
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<Menu | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const opener = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const nodes = useMemo(() => root ? filterLibraryTree(buildLibraryTree(root, entries, folders, archived), query) : [], [root, entries, folders, archived, query])

  useEffect(() => {
    setQuery(''); setArchived(false); setCollapsed(new Set()); setMenu(null); setEditor(null); setError('')
  }, [root])

  async function run(command: LibraryCommand) {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const change = await window.api.manageLibrary(command)
      onChange(change)
      return true
    } catch (reason) {
      const message = libraryErrorCopy(reason, ui)
      setError(message)
      onError(message)
      return false
    } finally { busyRef.current = false; setBusy(false) }
  }

  const openMenu = (target: Target | null, button: HTMLButtonElement) => {
    if (busy) return
    const rect = button.getBoundingClientRect()
    opener.current = button
    setMenu({ target, x: rect.left, y: rect.bottom + 4 })
  }
  const closeMenu = () => { setMenu(null); opener.current?.focus({ preventScroll: true }) }
  const edit = (kind: Editor['kind'], target: Target) => {
    setError(''); setMenu(null); setEditor({ kind, target })
  }
  const closeEditor = () => {
    if (busyRef.current) return
    setEditor(null)
    requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
      else panelRef.current?.querySelector<HTMLButtonElement>('.library-add')?.focus({ preventScroll: true })
    })
  }
  const folderTarget = (path: string, name = libraryName(path), isArchived = false): Target => ({ path, title: name, folder: true, archived: isArchived, fileIdentity: folders.find((item) => sameLibraryPath(item.path, path))?.fileIdentity })
  const menuAction = (kind: Editor['kind']) => {
    const target = menu?.target ?? (root ? folderTarget(root) : null)
    if (target) edit(kind, target)
  }
  const direct = (command: LibraryCommand) => { setMenu(null); void run({ ...command, documentId: menu?.target?.documentId, expectedIdentity: menu?.target?.fileIdentity }).then(() => opener.current?.focus({ preventScroll: true })) }

  const renderNodes = (items: LibraryNode[], depth = 0) => <ul className="library-nodes">
    {items.map((node) => {
      const folder = node.kind === 'folder'
      const target = folder ? folderTarget(node.path, node.name, node.archived) : {
        path: node.path, title: node.entry.title, folder: false, archived: !!node.entry.archived, bundlePath: node.bundlePath, stage: node.entry.stage, documentId: node.entry.id, fileIdentity: node.entry.fileIdentity
      }
      const expanded = !!query.trim() || !collapsed.has(node.path)
      const active = !folder && !!currentPath && sameLibraryPath(node.path, currentPath)
      return <li key={node.path} className={folder ? 'library-folder' : 'library-article'}>
        <div className={`library-row${active ? ' is-current' : ''}`} style={{ paddingLeft: Math.min(depth, 6) * 12 }}
          onContextMenu={folder ? (event) => {
            event.preventDefault(); const row = event.currentTarget
            opener.current = row.querySelector<HTMLButtonElement>('.library-row-menu')
            setMenu({ target, x: event.clientX, y: event.clientY })
          } : (event) => { event.preventDefault(); onFileMenu(node.path, { x: event.clientX, y: event.clientY }) }}>
          {folder ? <button type="button" className="library-folder-open" aria-expanded={expanded} title={node.path} onClick={() => setCollapsed((previous) => {
            const next = new Set(previous); if (next.has(node.path)) next.delete(node.path); else next.add(node.path); return next
          })}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={14} /><span>{node.name}</span>
            <span className="library-folder-count" aria-label={`${node.count} ${copy.folderCount}`}>{node.count}</span>
          </button> : <button type="button" className="library-article-open" aria-current={active ? 'page' : undefined}
            title={`${node.entry.title}\n${node.path}${node.entry.zhPath ? `\n${node.entry.zhPath}` : ''}`} onClick={() => onOpen(node.path)}
            onKeyDown={(event) => {
              if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
                event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect()
                onFileMenu(node.path, { x: rect.left, y: rect.bottom })
              }
            }}>
            <span className="library-article-title">{node.entry.title}</span>
            <span className="library-article-meta">
              <span className="library-article-path">{node.relativePath}</span>
              {node.entry.stage && node.entry.stage !== 'unmarked' && <span className="library-article-stage">{copy[node.entry.stage]}</span>}
            </span>
          </button>}
          <button type="button" className="library-row-menu" aria-label={`${copy.menu}: ${target.title}`} title={copy.menu}
            aria-haspopup="menu" aria-expanded={menu?.target?.path === node.path} aria-controls={menu?.target?.path === node.path ? menuId : undefined}
            disabled={busy} onClick={(event) => openMenu(target, event.currentTarget)}><MoreHorizontal size={15} /></button>
        </div>
        {folder && expanded && renderNodes(node.children, depth + 1)}
      </li>
    })}
  </ul>

  const menuTarget = menu?.target
  return <div ref={panelRef} className="library-panel" lang={ui === 'zh' ? 'zh-CN' : 'en'} onKeyDown={(event) => {
    // Keep article-reading shortcuts out of the library's editable controls and menus.
    if ((event.target as HTMLElement).closest('input, textarea, select, [role="menu"], dialog')) event.stopPropagation()
  }}>
    <div className="library-controls">
      <div className="library-tools">
        <label className="library-search"><Search size={14} aria-hidden="true" /><input type="search" value={query} placeholder={copy.search}
          aria-label={copy.search} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" aria-label={copy.close} onClick={() => setQuery('')}><X size={12} /></button>}
        </label>
        <button type="button" className="library-add" aria-label={copy.add} title={root ? copy.add : copy.noRoot} disabled={!root || busy}
          aria-haspopup="menu" aria-expanded={!!menu && !menu.target} onClick={(event) => openMenu(null, event.currentTarget)}><Plus size={17} /></button>
      </div>
      <div className="library-scope" role="group" aria-label={ui === 'zh' ? '文章范围' : 'Article scope'}>
        <button type="button" className={!archived ? 'on' : ''} aria-pressed={!archived} onClick={() => { setArchived(false); setMenu(null) }}>{copy.all}</button>
        <button type="button" className={archived ? 'on' : ''} aria-pressed={archived} onClick={() => { setArchived(true); setMenu(null) }}><Archive size={12} />{copy.archived}</button>
      </div>
    </div>
    {(issue || error && !editor) && <p className="library-error" role="alert">{error || libraryErrorCopy(issue, ui)}</p>}
    {nodes.length ? renderNodes(nodes) : <p className="library-empty">{!root ? copy.noRoot : query.trim() ? copy.noMatch : archived ? copy.noArchived : copy.noArticles}</p>}
    {menu && createPortal(<LibraryMenu id={menuId} x={menu.x} y={menu.y} label={menuTarget?.title ?? copy.add} onClose={closeMenu}>
      {(!menuTarget || menuTarget.folder && !menuTarget.archived) && <>
        <button role="menuitem" type="button" disabled={busy} onClick={() => menuAction('create-folder')}>{copy.folder}</button>
        <button role="menuitem" type="button" disabled={busy} onClick={() => menuAction('create-articles')}>{copy.articles}</button>
        {menuTarget && <div className="library-menu-divider" role="separator" />}
      </>}
      {menuTarget && <>
        <button role="menuitem" type="button" disabled={busy} onClick={() => menuAction('rename')}>{copy.rename}</button>
        <button role="menuitem" type="button" disabled={busy} onClick={() => menuAction('move')}>{copy.move}</button>
        {!menuTarget.folder && <>
          <button role="menuitem" type="button" disabled={busy} onClick={() => menuAction('stage')}>{copy.stage}{menuTarget.stage && menuTarget.stage !== 'unmarked' ? ` · ${copy[menuTarget.stage]}` : ''}</button>
          <button role="menuitem" type="button" disabled={busy} onClick={() => direct({ type: 'reorder', path: menuTarget.path, direction: 'up' })}>{copy.up}</button>
          <button role="menuitem" type="button" disabled={busy} onClick={() => direct({ type: 'reorder', path: menuTarget.path, direction: 'down' })}>{copy.down}</button>
        </>}
        <div className="library-menu-divider" role="separator" />
        <button role="menuitem" type="button" disabled={busy} onClick={() => menuAction(menuTarget.archived ? 'restore' : 'archive')}>{menuTarget.archived ? copy.restore : copy.archive}</button>
        {!menuTarget.folder && <>
          <div className="library-menu-divider" role="separator" />
          <button role="menuitem" type="button" disabled={busy} onClick={() => { setMenu(null); onFileMenu(menuTarget.path, { x: menu.x, y: menu.y }) }}>{copy.fileActions}</button>
        </>}
      </>}
    </LibraryMenu>, document.body)}
    {editor && root && <LibraryEditor key={`${editor.kind}:${editor.target.path}`} editor={editor} root={root} entries={entries} folders={folders} ui={ui}
      busy={busy} error={error} setError={setError} onClose={closeEditor} onSubmit={async (command) => { if (await run({ ...command, documentId: editor.target.documentId, expectedIdentity: editor.target.fileIdentity })) closeEditor() }} />}
  </div>
}

function LibraryMenu({ id, x, y, label, onClose, children }: { id: string; x: number; y: number; label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    const menu = ref.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) })
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) closeRef.current() }
    const close = () => closeRef.current()
    const scroll = (event: Event) => { if (!menu.contains(event.target as Node)) close() }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', scroll, true)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); window.removeEventListener('scroll', scroll, true) }
  }, [x, y])
  return <div ref={ref} id={id} role="menu" aria-label={label} className="library-menu" style={position} onKeyDown={(event) => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    if (event.key === 'Tab') onClose()
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }
  }}>{children}</div>
}

function LibraryEditor({ editor, root, entries, folders, ui, busy, error, setError, onClose, onSubmit }: {
  editor: Editor; root: string; entries: LibraryEntry[]; folders: LibraryFolder[]; ui: UiLang; busy: boolean; error: string
  setError: (error: string) => void; onClose: () => void; onSubmit: (command: LibraryCommand) => void
}) {
  const { kind, target } = editor
  const copy = words[ui]
  const id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const namePath = target.bundlePath ?? target.path
  const [name, setName] = useState(kind === 'rename' ? libraryName(namePath) : '')
  const [titles, setTitles] = useState('')
  const [stage, setStage] = useState<ArticleStage>(target.stage ?? 'unmarked')
  const destinations = useMemo(() => libraryDestinations(root, entries, folders, kind === 'move' ? namePath : undefined), [root, entries, folders, kind, namePath])
  const [destination, setDestination] = useState(() => {
    const parent = libraryParent(namePath)
    return destinations.find((path) => !sameLibraryPath(path, parent)) ?? ''
  })
  const articleTitles = parseArticleTitles(titles)
  const heading = kind === 'create-folder' ? copy.folder : kind === 'create-articles' ? copy.articles : kind === 'rename' ? copy.rename : kind === 'move' ? copy.move : kind === 'stage' ? copy.stage : kind === 'restore' ? copy.restoreTitle : target.folder ? copy.archiveFolder : copy.archiveTitle
  const description = kind === 'create-folder' ? copy.realFolder : kind === 'create-articles' ? copy.realArticles : kind === 'rename' ? copy.realRename : kind === 'move' ? copy.realMove : kind === 'stage' ? copy.realStage : kind === 'restore' ? copy.realRestore : copy.realArchive
  const submitLabel = kind === 'create-folder' || kind === 'create-articles' ? copy.create : kind === 'archive' ? copy.archive : kind === 'restore' ? copy.restore : kind === 'move' ? ui === 'zh' ? '移动' : 'Move' : copy.save
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (kind === 'create-folder' || kind === 'rename') {
      const trimmed = name.trim()
      if (!trimmed) { setError(copy.required); return }
      if (/[/\\\0]/.test(trimmed) || trimmed === '.' || trimmed === '..') { setError(copy.invalidName); return }
      onSubmit(kind === 'rename' ? { type: 'rename', path: target.path, name: trimmed } : { type: 'create-folder', parent: target.path, name: trimmed })
    } else if (kind === 'create-articles') {
      if (!articleTitles.length) { setError(copy.noTitles); return }
      if (articleTitles.length > 50) { setError(copy.tooMany); return }
      if (new Set(articleTitles.map((title) => title.toLocaleLowerCase())).size !== articleTitles.length) { setError(copy.duplicateTitles); return }
      onSubmit({ type: 'create-articles', folder: target.path, titles: articleTitles })
    } else if (kind === 'move') {
      if (!destination) { setError(copy.noDestination); return }
      onSubmit({ type: 'move', path: target.path, destination })
    } else if (kind === 'stage') onSubmit({ type: 'stage', path: target.path, stage })
    else onSubmit({ type: kind, path: target.path })
  }
  return <dialog ref={dialogRef} className="library-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy}
    onClose={onClose} onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }} onKeyDown={(event) => event.stopPropagation()}>
    <form onSubmit={submit}>
      <header className="library-dialog-header"><h2 id={`${id}-title`}>{heading}</h2><button type="button" aria-label={copy.close} disabled={busy} onClick={onClose}><X size={17} /></button></header>
      <div className="library-dialog-body">
        <p id={`${id}-description`}>{description}</p>
        <div className="library-local-path"><span>{copy.location}</span><code>{target.bundlePath ?? target.path}</code></div>
        {(kind === 'create-folder' || kind === 'rename') && <label className="library-field">{copy.name}<input autoFocus value={name} disabled={busy} maxLength={180} onChange={(event) => setName(event.target.value)} /></label>}
        {kind === 'create-articles' && <>
          <label className="library-field">{copy.titles}<textarea autoFocus value={titles} disabled={busy} rows={7} onChange={(event) => setTitles(event.target.value)} aria-describedby={`${id}-hint ${id}-count`} /></label>
          <p id={`${id}-hint`} className="library-form-hint">{copy.titleHint}</p>
          <p id={`${id}-count`} className={`library-title-count${articleTitles.length > 50 ? ' invalid' : ''}`} aria-live="polite">{ui === 'zh' ? `将新建 ${articleTitles.length} 篇文章` : `${articleTitles.length} articles to create`}</p>
        </>}
        {kind === 'move' && <label className="library-field">{copy.destination}<select autoFocus value={destination} disabled={busy || !destinations.length} size={Math.min(7, Math.max(3, destinations.length))} onChange={(event) => setDestination(event.target.value)}>
          {destinations.map((path) => <option key={path} value={path} disabled={sameLibraryPath(path, libraryParent(namePath))}>{sameLibraryPath(path, root) ? copy.root : libraryRelative(root, path)}</option>)}
        </select>{!destinations.length && <span className="library-form-hint">{copy.noDestinations}</span>}</label>}
        {kind === 'stage' && <label className="library-field">{copy.stage}<select autoFocus value={stage} disabled={busy} onChange={(event) => setStage(event.target.value as ArticleStage)}>{stages.map((value) => <option key={value} value={value}>{copy[value]}</option>)}</select></label>}
        {(kind === 'archive' || kind === 'restore') && <p className="library-confirm-title">{target.title}</p>}
        {error && <p className="library-error" role="alert">{error}</p>}
      </div>
      <footer className="library-dialog-footer"><button type="button" className="btn small ghost" autoFocus={kind === 'archive' || kind === 'restore'} disabled={busy} onClick={onClose}>{copy.cancel}</button>
        <button type="submit" className="btn small primary" disabled={busy || kind === 'create-articles' && (!articleTitles.length || articleTitles.length > 50) || kind === 'move' && !destination}>{busy ? copy.busy : submitLabel}</button></footer>
    </form>
  </dialog>
}
