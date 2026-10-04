import { useEffect, useRef } from 'react'
import { Copy, X } from 'lucide-react'
import type { Lang } from '@shared/types'
import type { QuoteAnchor } from '@shared/quote-anchor'
import { useT } from './i18n'

export type NoteEditorTarget = {
  sourcePath: string
  draftKey: string
  quote: string
  lang: Lang
  blockId: string | null
  blockKey: string | null
  quoteAnchor?: QuoteAnchor
  noteId?: string
  originalComment: string
  unavailable: boolean
  warning?: string
}

export function NoteEditor({ target, comment, hasDraft, persisted, saving, error, onComment, onSave, onClose, onDiscard, onCopy, onRestore, restoring }: {
  target: NoteEditorTarget
  comment: string
  hasDraft: boolean
  persisted: boolean
  saving: boolean
  error: string
  onComment: (value: string) => void
  onSave: () => void
  onClose: () => void
  onDiscard: () => void
  onCopy: () => void
  onRestore?: () => void
  restoring?: boolean
}) {
  const tr = useT()
  const ref = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const backdrop = ref.current?.parentElement
    const siblings = [...(backdrop?.parentElement?.children ?? [])]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop)
    const previousInert = siblings.map((element) => element.inert)
    siblings.forEach((element) => { element.inert = true })
    const onTab = (event: KeyboardEvent) => {
      const dialog = ref.current
      if (event.key !== 'Tab' || !dialog || dialog.closest('[inert]')) return
      const controls = dialog.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')
      if (!controls.length) { event.preventDefault(); return }
      const first = controls[0], last = controls[controls.length - 1]
      const focusOutside = !dialog.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || focusOutside)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || focusOutside)) {
        event.preventDefault(); first.focus()
      }
    }
    // Capture at document level: a removed or disabled control can leave focus on body.
    document.addEventListener('keydown', onTab, true)
    textarea.current?.focus()
    return () => {
      document.removeEventListener('keydown', onTab, true)
      siblings.forEach((element, index) => { element.inert = previousInert[index] })
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    const current = document.activeElement as HTMLElement | null
    if (!ref.current?.contains(current) || current?.matches(':disabled')) {
      if (saving) ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
      else textarea.current?.focus()
    }
  }, [saving, restoring, error])
  const title = target.noteId ? tr('editNote') : tr('continueDraft')
  const canSave = !saving && !target.unavailable && !!comment.trim() && (!target.noteId || comment !== target.originalComment)
  return (
    <div className="note-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="note-editor" ref={ref} role="dialog" aria-modal="true" aria-labelledby="note-editor-title" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose() }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          if (canSave) onSave()
        }
      }}>
        <div className="head">
          <h2 id="note-editor-title">{title}</h2>
          <span style={{ flex: 1 }} />
          <button className="btn icon ghost" aria-label={tr('close')} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="note-editor-meta" title={target.sourcePath}>
          {tr(target.lang === 'zh' ? 'readChinese' : 'readEnglish')} · {target.sourcePath.split(/[/\\]/).slice(-2).join('/')}
        </div>
        <div className="quoted">{target.quote}</div>
        {target.warning && <p className="note-editor-warning" role="status">{target.warning}</p>}
        {target.noteId && !target.warning && <p className="draft-hint">{tr('editNoteHint')}</p>}
        <label htmlFor="note-editor-comment">{tr('noteComment')}</label>
        <textarea id="note-editor-comment" ref={textarea} value={comment} disabled={saving} onChange={(event) => onComment(event.target.value)} placeholder={tr('notePlaceholder')} />
        {hasDraft && <p className="draft-hint">{tr(persisted ? 'draftKept' : 'draftSessionOnly')}</p>}
        {error && <p className="note-error" role="alert">{error}</p>}
        {error && onRestore && <button className="btn small ghost" disabled={restoring} onClick={onRestore}>{tr(restoring ? 'restoringReview' : 'restoreReview')}</button>}
        <div className="actions">
          <button className="btn small ghost" onClick={onCopy} disabled={!comment.trim()}><Copy size={14} />{tr('copyOne')}</button>
          {hasDraft && <button className="btn small ghost" onClick={onDiscard} disabled={saving}>{tr('discardDraft')}</button>}
          <span className="spacer" />
          <button className="btn small ghost" onClick={onClose}>{tr('close')}</button>
          <button className="btn small primary" disabled={!canSave} onClick={onSave}>{tr(saving ? 'savingNote' : target.noteId ? 'saveChanges' : 'saveNote')}</button>
        </div>
      </div>
    </div>
  )
}
