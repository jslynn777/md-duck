import { useEffect, useId, useRef, useState } from 'react'
import { Copy, Folder, FolderOpen, FolderPlus, LoaderCircle, MoreHorizontal, PanelsTopLeft, RefreshCw, X } from 'lucide-react'
import type { SpaceSummary } from '../../shared/spaces'
import type { UiLang } from '../../shared/types'
import { useSpacePresence } from './space-motion'
import './spaces.css'

export function spaceError(error: unknown, ui: UiLang): string {
  const code = error instanceof Error ? error.message : String(error)
  const zh = ui === 'zh'
  if (/DRAFT_UNSAVED/i.test(code)) return zh ? '批注草稿尚未安全保存，请先复制或保存草稿。' : 'Note drafts could not be saved. Copy or save them before switching spaces.'
  if (/WINDOW_OPEN/i.test(code)) return zh ? '这个空间正在另一个窗口中使用。请先关闭那个窗口，再修改空间位置或移除入口。' : 'This space is open in another window. Close that window before relocating or removing the space.'
  if (/SPACE_FOLDER/i.test(code)) return zh ? '请选择一个可以访问的本地文件夹。' : 'Choose an accessible local folder.'
  if (/SPACE_SETTINGS/i.test(code)) return zh ? '这个空间的设置暂时无法读取或保存，原文件已保留。请检查应用数据目录的访问权限后重试。' : 'This space’s settings could not be read or saved. The original file is preserved. Check access to the application data folder and try again.'
  if (/OVERLAP/i.test(code)) return zh ? '这个文件夹与已有空间重叠。请打开已有空间，或选择独立的文件夹。' : 'This folder overlaps an existing space. Open that space or choose a separate folder.'
  if (/BUSY|TRANSLAT/i.test(code)) return zh ? '正在保存或处理文件，请完成后再切换空间。' : 'Files are being saved or processed. Try again when this operation finishes.'
  if (/MISSING|NOT_FOUND|ENOENT/i.test(code)) return zh ? '找不到这个空间的本地文件夹。请使用“重新定位文件夹”。' : 'The local folder is missing. Use “Locate folder”.'
  if (/CORRUPT|INVALID_STORE|UNREADABLE/i.test(code)) return zh ? '空间记录暂时无法读取，原记录已保留。请检查文件权限后重试。' : 'Space records could not be read. Existing records are preserved; check file permissions and try again.'
  if (/NAME|INVALID/i.test(code)) return zh ? '请检查空间名称和目标路径。' : 'Check the space name and target path.'
  return zh ? '操作未完成，请检查本地文件夹和访问权限后重试。' : 'The operation could not finish. Check the local folder and its permissions, then try again.'
}

type Props = {
  open?: boolean
  ui: UiLang
  spaces: SpaceSummary[]
  activeSpaceId: string | null
  onOpen: (id: string, separateWindow: boolean) => Promise<void>
  onAdd: () => Promise<void>
  onRemove: (id: string) => Promise<void>
  onRelocate: (id: string) => Promise<void>
  onContext: (space: SpaceSummary) => void
  onClose: () => void
}

export function SpaceOverview({ open = true, ui, spaces, activeSpaceId, onOpen, onAdd, onRemove, onRelocate, onContext, onClose }: Props) {
  const zh = ui === 'zh'
  const dialogRef = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const present = useSpacePresence(open, 200, () => {
    dialogRef.current?.close()
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
  })
  const titleId = useId()
  const [items, setItems] = useState(spaces)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ kind: 'rename' | 'remove'; space: SpaceSummary } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setItems(spaces) }, [spaces])
  useEffect(() => {
    if (!open) return
    if (dialogRef.current && !dialogRef.current.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialogRef.current.showModal()
    }
    let live = true
    setError(''); setMenu(null); setEditing(null)
    setRefreshing(true)
    void window.api.listSpaces().then(next => { if (live) setItems(next) }).catch(reason => { if (live) setError(spaceError(reason, ui)) }).finally(() => { if (live) setRefreshing(false) })
    return () => { live = false }
  }, [open])
  useEffect(() => { if (menu) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus() }, [menu])
  async function run(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true); setError(''); setMenu(null)
    try { await action() } catch (reason) { setError(spaceError(reason, ui)) } finally { setBusy(false) }
  }
  const close = () => { if (!busy) onClose() }
  if (!present) return null
  return <dialog ref={dialogRef} className="spaces-overview" data-state={open ? 'open' : 'closing'} inert={!open} aria-labelledby={titleId} onClose={event => { if (!event.currentTarget.open) onClose() }}
    onCancel={event => { event.preventDefault(); if (menu) { setMenu(null); return } close() }}
    onPointerDown={event => { if (!(event.target as HTMLElement).closest('.space-menu, .space-menu-button')) setMenu(null) }}
    onKeyDown={event => {
      event.stopPropagation()
      if (!menu || !menuRef.current) return
      const controls = [...menuRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const at = controls.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); controls[(at + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length]?.focus() }
      if (event.key === 'Escape') { event.preventDefault(); setMenu(null); dialogRef.current?.querySelector<HTMLButtonElement>(`[data-space-menu="${menu}"]`)?.focus() }
    }}>
    <header className="spaces-header"><span className="spaces-brand">MD Duck</span><span className="spaces-header-label">{zh ? '文章空间' : 'Article spaces'}</span><button autoFocus className="btn ghost icon" disabled={busy} onClick={close} aria-label={zh ? '返回阅读' : 'Return to reading'}><X size={18} /></button></header>
    <div className="spaces-scroll">
      <div className="spaces-title-row"><h1 id={titleId}>{zh ? '我的空间' : 'Your spaces'}<span>{items.length}</span></h1><button className="btn space-add" disabled={busy} onClick={() => void run(onAdd)}><FolderPlus size={17} />{zh ? '添加文件夹' : 'Add folder'}</button></div>
      {error && <p className="spaces-error" role="alert">{error}</p>}
      <div className="spaces-grid">
        {items.map(space => {
          const current = space.id === activeSpaceId
          const available = space.availability === 'ready'
          const settingsUnavailable = !available && space.unavailableReason === 'settings'
          const subtitle = settingsUnavailable ? (zh ? '空间设置暂时无法读取' : 'Space settings cannot be read') : space.availability === 'missing' ? (zh ? '文件夹已移动或暂时未连接' : 'Folder moved or disconnected') : space.availability === 'unreadable' ? (zh ? '文件夹暂时无法读取' : 'Folder cannot be read') : ''
          return <div className={`space-card${current ? ' is-current' : ''}`} key={space.id} onContextMenu={event => { event.preventDefault(); if (!busy) setMenu(space.id) }}>
            <button className="space-card-open" disabled={busy || !available} aria-current={current ? 'true' : undefined} aria-label={zh ? `打开空间：${space.name}` : `Open space: ${space.name}`} onClick={() => void run(() => onOpen(space.id, false))}>
              <div className="space-preview" aria-hidden="true">
                {available && space.lastTitle ? <><span className="space-preview-label">{zh ? '上次阅读' : 'Last read'}</span><h2>{space.lastTitle}</h2>{space.previewText ? <p>{space.previewText}</p> : <span className="space-preview-file">{space.openPath?.replace(/\\/g, '/').split('/').slice(-2).join('/')}</span>}</> : <div className="space-preview-empty"><FolderOpen size={26} strokeWidth={1.25} /><span>{available ? (zh ? '打开本地文章' : 'Open local articles') : subtitle}</span></div>}
              </div>
              <span className="space-name-row"><span className="space-name">{space.name}</span>{current ? <span className="space-current-label">{zh ? '当前空间' : 'Current'}</span> : space.windowOpen ? <span className="space-current-label">{zh ? '窗口已打开' : 'Open window'}</span> : null}</span>
              <span className="space-root" title={space.root}>{space.root}</span>
            </button>
            <div className="space-card-footer"><div className="space-card-status">
              {settingsUnavailable ? <span>{zh ? '其他空间仍可打开' : 'Other spaces remain available'}</span> : !available ? <button className="space-locate" disabled={busy} onClick={() => void run(() => onRelocate(space.id))}>{zh ? '重新定位文件夹' : 'Locate folder'}</button> : typeof space.changedCount === 'number' && space.changedCount > 0 ? <span className="space-changes"><span aria-hidden="true" />{zh ? `${space.changedCount} 篇改动待查看` : `${space.changedCount} updated`}</span> : space.changeIssue ? <span>{zh ? '改动检查暂不可用' : 'Change check unavailable'}</span> : <span>{zh ? '继续上次阅读' : 'Continue reading'}</span>}
            </div><button className="btn ghost icon space-menu-button" data-space-menu={space.id} disabled={busy} aria-haspopup="menu" aria-expanded={menu === space.id} aria-label={zh ? `管理空间：${space.name}` : `Manage space: ${space.name}`} onClick={() => setMenu(menu === space.id ? null : space.id)}><MoreHorizontal size={18} /></button></div>
            {menu === space.id && <div className="space-menu" role="menu" ref={menuRef} aria-label={space.name}>
              <button role="menuitem" disabled={!available} onClick={() => void run(() => onOpen(space.id, true))}>{zh ? '在独立窗口打开' : 'Open in separate window'}</button>
              <button role="menuitem" onClick={() => { setMenu(null); onContext(space) }}>{zh ? '给 AI 的空间说明' : 'Space instructions for AI'}</button>
              <button role="menuitem" onClick={() => { setMenu(null); setEditing({ kind: 'rename', space }) }}>{zh ? '重命名空间' : 'Rename space'}</button>
              <button role="menuitem" onClick={() => void run(() => onRelocate(space.id))}>{zh ? '重新定位文件夹…' : 'Locate folder…'}</button>
              <button role="menuitem" onClick={() => { setMenu(null); setEditing({ kind: 'remove', space }) }}>{zh ? '从空间列表移除…' : 'Remove from spaces…'}</button>
            </div>}
          </div>
        })}
      </div>
      {items.length === 0 && <div className="spaces-empty"><PanelsTopLeft size={32} strokeWidth={1.3} /><h2>{zh ? '一个文件夹，一个阅读空间' : 'One folder, one reading space'}</h2><p>{zh ? '添加已有的文章文件夹，即可随时回来继续阅读。' : 'Add a local article folder and return to your reading whenever you need.'}</p></div>}
      <footer className="spaces-foot"><span><Folder size={14} />{zh ? '内容保存在原来的本地文件夹' : 'Files stay in their original local folders'}</span>{refreshing && <span role="status"><LoaderCircle size={14} className="spin" />{zh ? '检查空间…' : 'Checking spaces…'}</span>}</footer>
    </div>
    {editing && <SpaceEdit ui={ui} kind={editing.kind} space={editing.space} onClose={() => setEditing(null)} onSave={async name => {
      if (editing.kind === 'rename') setItems(await window.api.renameSpace(editing.space.id, name))
      else await onRemove(editing.space.id)
      setEditing(null)
    }} />}
  </dialog>
}

function SpaceEdit({ ui, kind, space, onClose, onSave }: { ui: UiLang; kind: 'rename' | 'remove'; space: SpaceSummary; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const zh = ui === 'zh', ref = useRef<HTMLDialogElement>(null), id = useId()
  const [name, setName] = useState(space.name), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal() }, [])
  return <dialog ref={ref} className="space-dialog" aria-labelledby={id} onClose={event => { event.stopPropagation(); onClose() }} onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) ref.current?.close() }}>
    <form onSubmit={event => { event.preventDefault(); if (busy || !name.trim()) return; setBusy(true); setError(''); void onSave(name.trim()).catch(reason => setError(spaceError(reason, ui))).finally(() => setBusy(false)) }}>
      <header><h2 id={id}>{kind === 'rename' ? (zh ? '重命名空间' : 'Rename space') : (zh ? '从空间列表移除？' : 'Remove from spaces?')}</h2><button type="button" className="btn ghost icon" disabled={busy} aria-label={zh ? '关闭' : 'Close'} onClick={() => ref.current?.close()}><X size={18} /></button></header>
      {kind === 'rename' ? <><label className="space-form-label">{zh ? '空间名称' : 'Space name'}<input autoFocus maxLength={80} value={name} required disabled={busy} onChange={event => setName(event.target.value)} /></label><p>{zh ? '只修改显示名称，本地文件夹名称保持不变。' : 'Only the display name changes. The local folder keeps its name.'}</p></> : <><p className="space-remove-name">{space.name}</p><p>{zh ? '本地文章、译文、批注和空间阅读记录都会保留。以后可重新添加这个文件夹。' : 'Local articles, translations, notes and space reading records are preserved. You can add this folder again later.'}</p></>}
      {error && <p role="alert" className="spaces-error">{error}</p>}
      <footer><button type="button" className="btn ghost" disabled={busy} onClick={() => ref.current?.close()}>{zh ? '取消' : 'Cancel'}</button><button type="submit" className="btn primary" disabled={busy || !name.trim()}>{busy ? (zh ? '正在保存…' : 'Saving…') : kind === 'rename' ? (zh ? '保存' : 'Save') : (zh ? '移除快捷入口' : 'Remove shortcut')}</button></footer>
    </form>
  </dialog>
}

export function SpaceContext({ ui, space, path, onClose }: { ui: UiLang; space: SpaceSummary; path?: string; onClose: () => void }) {
  const zh = ui === 'zh', ref = useRef<HTMLDialogElement>(null), textarea = useRef<HTMLTextAreaElement>(null), id = useId()
  const [context, setContext] = useState<{ text: string; url: string } | null>(null), [error, setError] = useState(''), [copied, setCopied] = useState(false), [refresh, setRefresh] = useState(0)
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal() }, [])
  useEffect(() => { let live = true; setError(''); setContext(null); setCopied(false); void window.api.getSpaceContext(space.id, path).then(value => { if (live) setContext(value) }).catch(reason => { if (live) setError(spaceError(reason, ui)) }); return () => { live = false } }, [space.id, path, refresh])
  return <dialog ref={ref} className="space-dialog space-context" aria-labelledby={id} onClose={onClose} onCancel={event => { event.preventDefault(); ref.current?.close() }}>
    <header><h2 id={id}>{zh ? '给 AI 的空间说明' : 'Space instructions for AI'}</h2><button autoFocus className="btn ghost icon" aria-label={zh ? '关闭' : 'Close'} onClick={() => ref.current?.close()}><X size={18} /></button></header>
    <p className="space-context-name"><FolderOpen size={15} />{space.name}</p><p>{zh ? '复制到你使用的 AI 对话中，明确本次任务的目录、文章和打开方式。' : 'Paste into your AI conversation to specify the folder, article and how to open this space.'}</p>
    {context ? <textarea ref={textarea} readOnly spellCheck={false} aria-label={zh ? '空间说明和定位信息' : 'Space instructions and location'} value={context.text} /> : error ? <div className="space-context-error"><p className="spaces-error" role="alert">{error}</p><button className="btn ghost" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} />{zh ? '重试' : 'Retry'}</button></div> : <p role="status"><LoaderCircle size={15} className="spin" /> {zh ? '正在读取空间信息…' : 'Reading space details…'}</p>}
    <footer><span role="status">{copied ? (zh ? '已复制，可以粘贴给 AI' : 'Copied. Paste into your AI.') : (zh ? '只复制说明，不发送文章内容' : 'Copies instructions, without sending article content')}</span><button className="btn primary" disabled={!context} onClick={() => {
      if (!context) return
      void window.api.copyText(context.text).then(() => setCopied(true)).catch(() => { textarea.current?.focus(); textarea.current?.select(); setError(zh ? '自动复制失败，请选择内容后复制。' : 'Automatic copy failed. Select and copy the text.') })
    }}><Copy size={15} />{zh ? '复制说明' : 'Copy instructions'}</button></footer>
    {context && error && <p role="alert" className="spaces-error">{error}</p>}
  </dialog>
}
