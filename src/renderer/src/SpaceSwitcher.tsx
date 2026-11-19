import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, FolderPlus, LoaderCircle, PanelsTopLeft } from 'lucide-react'
import type { SpaceSummary } from '../../shared/spaces'
import type { UiLang } from '../../shared/types'
import { spaceError } from './Spaces'
import { codexPhaseLabel } from './CodexTaskPanel'
import { useSpacePresence } from './space-motion'

/** Covers are host-authorized local assets; opening the menu never fetches remote images. */
export function spaceCoverImages(images?: string[]): string[] {
  return [...new Set(images ?? [])].filter(value => {
    try {
      const url = new URL(value)
      return url.protocol === 'md-duck:' && url.hostname === 'asset' && !!url.searchParams.get('scope') && !!url.searchParams.get('path')
    } catch { return false }
  }).slice(0, 4)
}

export function SpaceCover({ space }: { space?: Pick<SpaceSummary, 'previewImages'> }) {
  const [failed, setFailed] = useState<string[]>([])
  const images = spaceCoverImages(space?.previewImages).filter(image => !failed.includes(image))
  return <span className="space-cover" data-count={images.length} aria-hidden="true">
    {images.length ? images.map(image => <img key={image} src={image} alt="" draggable={false} onError={() => setFailed(previous => [...previous, image])} />)
      : <span className="space-cover-paper"><i /><i /><i /><i /></span>}
  </span>
}

export function spaceAvailabilityCopy(space: SpaceSummary, ui: UiLang): string {
  if (space.unavailableReason === 'settings') return ui === 'zh' ? '空间设置暂时无法读取' : 'Space settings cannot be read'
  if (space.availability === 'missing') return ui === 'zh' ? '文件夹已移动或未连接' : 'Folder moved or disconnected'
  if (space.availability === 'unreadable') return ui === 'zh' ? '文件夹暂时无法读取' : 'Folder cannot be read'
  return ''
}

type Props = {
  ui: UiLang
  spaces: SpaceSummary[]
  activeSpaceId: string | null
  pendingId?: string
  onSwitch: (id: string) => Promise<void>
  onAdd: () => Promise<void>
  onManage: () => void
}

export function SpaceSwitcher({ ui, spaces, activeSpaceId, pendingId, onSwitch, onAdd, onManage }: Props) {
  const zh = ui === 'zh'
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const menuPresent = useSpacePresence(open, 160)
  const [items, setItems] = useState(spaces)
  const latestSpaces = useRef(spaces)
  latestSpaces.current = spaces
  const [position, setPosition] = useState({ top: 46, right: 18 })
  const id = useId()
  const active = spaces.find(space => space.id === activeSpaceId)
  const pending = spaces.find(space => space.id === pendingId)
  useEffect(() => { setItems(spaces) }, [spaces])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => { const rect = trigger.current?.getBoundingClientRect(); if (rect) setPosition({ top: rect.bottom + 7, right: Math.max(10, window.innerWidth - rect.right) }) }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])
  useEffect(() => {
    if (!open) return
    let live = true
    const basis = latestSpaces.current
    void window.api.listSpaces().then(next => { if (live && basis === latestSpaces.current) setItems(next) }).catch(reason => { if (live) setError(spaceError(reason, ui)) })
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    const selected = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)') ?? menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    selected?.focus()
    return () => { live = false; document.removeEventListener('pointerdown', outside) }
  }, [open])
  function close(restoreFocus = true) { setOpen(false); if (restoreFocus) trigger.current?.focus() }
  async function run(action: () => Promise<void>) {
    if (busy || pendingId) return
    setBusy(true); setError('')
    try { await action(); close() } catch (reason) { setError(spaceError(reason, ui)) } finally { setBusy(false) }
  }
  return <div ref={root} className="space-switcher" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && !menu.current?.contains(event.relatedTarget as Node)) setOpen(false)
  }} onKeyDown={event => {
    if (!open) return
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    const controls = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const at = controls.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length
      controls[next]?.focus()
    }
  }}>
    <button ref={trigger} type="button" className="space-switch-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-label={zh ? `切换空间${active ? `：${active.name}` : ''}` : `Switch space${active ? `: ${active.name}` : ''}`}
      title={active ? `${active.name}\n${active.root}` : zh ? '选择文章空间' : 'Choose an article space'}
      onClick={() => { setError(''); setOpen(value => !value) }} onKeyDown={event => {
        if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setOpen(true) }
      }}>
      <SpaceCover space={pending ?? active} />
      <span className="space-switch-name">{pending ? (zh ? `打开 ${pending.name}…` : `Opening ${pending.name}…`) : active?.name ?? (zh ? '选择空间' : 'Choose space')}</span>
      {pendingId ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
    </button>
    {menuPresent && createPortal(<div ref={menu} id={id} className="space-switch-menu" data-state={open ? 'open' : 'closing'} inert={!open} aria-hidden={!open} style={{ top: position.top, right: position.right, maxHeight: `min(520px, calc(100vh - ${position.top + 12}px))` }} role="menu" aria-label={zh ? '切换文章空间' : 'Switch article space'} aria-busy={busy || !!pendingId}>
      <div className="space-switch-list">
        {items.map(space => {
          const unavailable = spaceAvailabilityCopy(space, ui), current = space.id === activeSpaceId
          const activity = space.activity?.kind === 'translation' ? (zh ? '正在翻译' : 'Translating') : space.activity?.kind === 'external-write' ? (zh ? '文件已更新' : 'Files updated') : ''
          const taskStatus = space.codexTask ? codexPhaseLabel(space.codexTask.phase, ui) : ''
          return <button type="button" role="menuitemradio" aria-checked={current} tabIndex={-1} key={space.id}
            className={`space-switch-item${current ? ' is-current' : ''}`} disabled={busy || !!pendingId || !!unavailable}
            title={`${space.name}\n${space.root}${space.activity?.path ? `\n${space.activity.path}` : ''}`}
            onClick={() => void run(() => onSwitch(space.id))}>
            <SpaceCover space={space} />
            <span className="space-switch-copy"><span className="space-switch-item-name">{space.name}</span>
              <span className="space-switch-detail">{unavailable || taskStatus || (space.activity?.kind === 'translation' ? activity : '') || (typeof space.changedCount === 'number' && space.changedCount > 0
                ? <span className="space-changes"><span aria-hidden="true" />{zh ? `${space.changedCount} 篇改动待查看` : `${space.changedCount} updated`}</span>
                : space.changeIssue ? (zh ? '改动检查暂不可用' : 'Change check unavailable') : activity || (space.windowOpen && !current ? (zh ? '已在独立窗口打开' : 'Open in another window') : space.lastTitle ?? space.root))}</span>
            </span>
            <span className="space-switch-check">{pendingId === space.id ? <LoaderCircle className="spin" size={15} /> : current ? <Check size={16} /> : null}</span>
          </button>
        })}
        {!items.length && <p className="space-switch-empty">{zh ? '添加文章文件夹，创建第一个空间。' : 'Add an article folder to create your first space.'}</p>}
      </div>
      {error && <p className="space-switch-error" role="alert">{error}</p>}
      <div className="space-switch-actions">
        <button type="button" role="menuitem" tabIndex={-1} disabled={busy || !!pendingId} onClick={() => void run(onAdd)}><FolderPlus size={15} />{zh ? '添加文件夹…' : 'Add folder…'}</button>
        <button type="button" role="menuitem" tabIndex={-1} disabled={busy || !!pendingId} onClick={() => { close(); onManage() }}><PanelsTopLeft size={15} />{zh ? '管理空间' : 'Manage spaces'}</button>
      </div>
    </div>, document.body)}
  </div>
}
