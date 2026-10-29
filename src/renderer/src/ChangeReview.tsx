import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, RefreshCw, X } from 'lucide-react'
import { compareDocumentChanges, type DocumentChange, type DocumentChangeState, type ArticleChangeSummary } from '@shared/document-changes'
import type { UiLang } from '@shared/types'
import './change-review.css'

type Props = {
  sourcePath: string
  documentId?: string
  sourceText: string
  zhText: string | null
  version: number
  summary?: ArticleChangeSummary
  ui: UiLang
  onLocate: (change: DocumentChange, focus?: boolean) => void
  onClose: () => void
  onReload: () => void
}

/** Acknowledgement is only enabled for the exact disk revision already on screen. */
export function ChangeReview({ sourcePath, documentId, sourceText, zhText, version, summary, ui, onLocate, onClose, onReload }: Props) {
  const en = ui === 'en'
  const [snapshot, setSnapshot] = useState<DocumentChangeState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'unavailable' | 'newer' | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [index, setIndex] = useState(0)
  const [selection, setSelection] = useState<DocumentChange | null>(null)
  const [retry, setRetry] = useState(0)
  const request = useRef(0)
  const pending = useRef(false)
  const panelId = useId()
  const openButton = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const locateRef = useRef(onLocate)
  locateRef.current = onLocate

  useEffect(() => {
    setSnapshot(null); setExpanded(false); setIndex(0); setSelection(null); setError(null)
    closeRef.current()
  }, [sourcePath, documentId])

  useEffect(() => {
    const ticket = ++request.current
    setLoading(true)
    void window.api.getDocumentChanges(sourcePath, documentId).then(next => {
      if (request.current !== ticket) return
      setSnapshot(next); setError(null); setLoading(false)
    }).catch(() => {
      if (request.current !== ticket) return
      setLoading(false); setError('unavailable')
    })
    return () => { if (request.current === ticket) request.current++ }
  }, [sourcePath, documentId, sourceText, zhText, version, summary, retry])

  const matches = !!snapshot && snapshot.current.sourceText === sourceText && snapshot.current.zhText === zhText
  const changes = useMemo(() => snapshot ? compareDocumentChanges(snapshot.baseline, { sourceText, zhText }) : [], [snapshot?.baseline, sourceText, zhText])
  const changed = !!snapshot && (snapshot.baseline.sourceText !== sourceText || snapshot.baseline.zhText !== zhText)
  const selectedIndex = selection ? changes.findIndex(change => change.id === selection.id
    || (selection.beforeKey && change.beforeKey === selection.beforeKey && change.side === selection.side)) : -1
  const currentIndex = selectedIndex >= 0 ? selectedIndex : Math.min(index, Math.max(0, changes.length - 1))
  const current = changes[currentIndex]
  const sourceCount = changes.filter(change => change.side === 'source').length
  const translationCount = changes.length - sourceCount
  const outOfDate = !!snapshot && !matches
  const hasIssue = !!error || (!snapshot && !!summary?.issue) || !!snapshot?.issue

  useEffect(() => {
    if (!loading && !changed && matches && !hasIssue) { setExpanded(false); setIndex(0); setSelection(null); closeRef.current() }
  }, [loading, changed, matches, hasIssue])
  useEffect(() => () => closeRef.current(), [])
  useEffect(() => {
    if (!expanded) return
    if (current) locateRef.current(current, false)
    else closeRef.current()
  }, [expanded, current?.targetKey, current?.side])

  async function acknowledge() {
    if (!snapshot || !matches || hasIssue || loading || pending.current) return
    pending.current = true
    setBusy(true)
    const ticket = request.current
    try {
      const next = await window.api.acknowledgeDocumentChanges(sourcePath, snapshot.revision, documentId)
      setExpanded(false); setIndex(0); setSelection(null); closeRef.current()
      if (ticket !== request.current) { setRetry(value => value + 1); return }
      setSnapshot(next); setError(null)
    } catch (reason) {
      if (ticket !== request.current) return
      setError(String(reason).includes('ERR_DOCUMENT_CHANGED') ? 'newer' : 'unavailable')
    } finally { pending.current = false; setBusy(false) }
  }
  function select(next: number) {
    const selected = Math.max(0, Math.min(changes.length - 1, next))
    setIndex(selected)
    setSelection(changes[selected] ?? null)
  }
  function close() { setExpanded(false); onClose(); openButton.current?.focus() }
  if (!changed && !summary?.changed && !hasIssue && !outOfDate) return null
  const labels = en ? { added: 'Added', modified: 'Edited', deleted: 'Removed', moved: 'Moved' } : { added: '新增', modified: '修改', deleted: '删除', moved: '位置调整' }
  return <section className="change-review" aria-label={en ? 'Changes since your last confirmation' : '上次确认之后的改动'} data-change-review onKeyDown={event => { if (expanded && event.key === 'Escape') { event.stopPropagation(); close() } }}>
    <div className="change-review-bar">
      <p className="change-review-summary" role="status">
        <span className="change-review-dot" aria-hidden="true" />
        <strong>{hasIssue ? (en ? 'Change check unavailable' : '改动检查暂不可用') : en ? 'Content updated' : '内容已更新'}</strong>
        {!hasIssue && <span>{loading || outOfDate ? (en ? 'Checking the latest saved files…' : '正在核对最新文件…') : changes.length ? (en ? `Since last confirmed · original ${sourceCount} / translation ${translationCount}` : `与上次确认相比 · 原文 ${sourceCount} 处 / 译文 ${translationCount} 处`) : (en ? 'The saved file differs from your last confirmed version.' : '文件与上次确认的版本不同。')}</span>}
      </p>
      <div className="change-review-actions">
        <button ref={openButton} type="button" className="btn change-view" aria-expanded={expanded} aria-controls={panelId} disabled={!changes.length || !!hasIssue} onClick={() => {
          if (expanded) close()
          else { setExpanded(true); select(currentIndex) }
        }}>{expanded ? (en ? 'Close comparison' : '收起对照') : (en ? 'View changes' : '查看改动')}</button>
        <button type="button" className="btn change-acknowledge" disabled={busy || loading || !matches || hasIssue} onClick={() => void acknowledge()}><Check size={13} />{busy ? (en ? 'Saving…' : '正在保存…') : (en ? 'Mark as viewed' : '标为已查看')}</button>
      </div>
    </div>
    {(hasIssue || outOfDate) && <div className="change-review-issue" role="status"><span>{error === 'newer' || outOfDate
      ? (en ? 'Another edit was saved. Read the latest version before marking it as viewed.' : '文件又有新修改，请读取最新内容后再确认。')
      : (en ? 'Your article is still readable. The comparison baseline could not be checked; it has not been overwritten.' : '文章仍可阅读。暂时无法核对比较记录，原有记录未被覆盖。')}</span>
      <button type="button" className="btn" disabled={loading} onClick={() => { setRetry(value => value + 1); if (outOfDate || error === 'newer') onReload() }}><RefreshCw size={12} />{outOfDate || error === 'newer' ? (en ? 'Read latest' : '读取最新内容') : (en ? 'Retry' : '重试')}</button>
    </div>}
    {expanded && current && <div className="change-comparison" id={panelId}>
      <div className="change-comparison-tools">
        <span>{current.side === 'source' ? (en ? 'Original' : '原文') : (en ? 'Translation' : '译文')} · {labels[current.kind]}</span>
        <div className="change-comparison-nav"><button type="button" className="btn icon" aria-label={en ? 'Previous change' : '上一处改动'} disabled={currentIndex === 0} onClick={() => select(currentIndex - 1)}><ArrowUp size={14} /></button><span aria-live="polite">{currentIndex + 1} / {changes.length}</span><button type="button" className="btn icon" aria-label={en ? 'Next change' : '下一处改动'} disabled={currentIndex === changes.length - 1} onClick={() => select(currentIndex + 1)}><ArrowDown size={14} /></button></div>
        <button type="button" className="btn change-locate" disabled={!current.targetKey} onClick={() => onLocate(current, true)}>{en ? 'Locate in article' : current.side === 'zh' ? '定位译文' : '定位原文'}</button>
        <button type="button" className="btn icon" aria-label={en ? 'Close comparison' : '关闭改动对照'} onClick={close}><X size={14} /></button>
      </div>
      <div className="change-comparison-content">
        <div className="change-before"><h3>{en ? 'Last confirmed' : '上次确认的内容'}</h3>{current.before ? <pre>{current.before}</pre> : <p className="change-empty">{en ? 'This passage is new.' : '这是一段新增内容。'}</p>}</div>
        <div className="change-after"><h3>{en ? 'Current version' : '现在的内容'}</h3>{current.after ? <pre>{current.after}</pre> : <p className="change-empty">{en ? 'This passage was removed. Locate jumps to a nearby surviving passage when available.' : '这段内容已删除；定位会跳到仍存在的邻近段落。'}</p>}</div>
      </div>
      <p className="change-comparison-note">{en ? 'Only the last confirmed version is kept locally. Marking as viewed does not change the article or its review progress.' : '仅在本地保留上次确认的版本。标为已查看不会修改文章，也不会改变审阅进度。'}</p>
    </div>}
  </section>
}
