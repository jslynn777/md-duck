import { useId, useState } from 'react'
import { Check, ChevronDown, Circle, CircleCheck, Copy, Pencil, RotateCcw, Trash, Unlink, X } from 'lucide-react'
import { reasonText, t } from '@shared/i18n'
import type { Note, UiLang } from '@shared/types'
import { useT, useUi } from './i18n'

export type NoteDraftItem = {
  key: string
  quote: string
  comment: string
  lang: 'source' | 'zh'
  documentLabel: string
  isCurrent: boolean
  isEdit: boolean
  unavailable: boolean
}

export function NotesPanel({
  notes,
  activeId,
  onJump,
  onCopy,
  onStatus,
  onDelete,
  onClose,
  onEdit,
  drafts,
  onResumeDraft
}: {
  notes: Note[]
  activeId: string | null
  onJump: (note: Note) => void
  onCopy: (list: Note[]) => void
  onStatus: (id: string, status: Note['status']) => void
  onDelete: (id: string) => void
  onClose: () => void
  onEdit: (note: Note) => void
  drafts: NoteDraftItem[]
  onResumeDraft: (key: string) => void
}) {
  const tr = useT()
  const ui = useUi()
  const [draftsExpanded, setDraftsExpanded] = useState(true)
  const headingId = useId()
  const draftsId = useId()
  const open = notes.filter((note) => note.status !== 'resolved')

  return (
    <aside className="notes review-notes" aria-labelledby={headingId}>
      <div className="notes-head">
        <h2 className="notes-heading" id={headingId}>
          {tr('notesTitle')}
          <span className="notes-count" aria-label={tr('noteCount', { n: notes.length })}>{notes.length}</span>
        </h2>
        <button className="btn small ghost" disabled={open.length === 0} onClick={() => onCopy(open)}>
          <Copy size={14} /> {tr('copyOpen')}
        </button>
        <button className="btn icon ghost" onClick={onClose} title={tr('close')} aria-label={tr('close')}>
          <X size={16} />
        </button>
      </div>
      <div className="notes-scroll">
        {drafts.length > 0 && (
          <section className="note-drafts">
            <button
              className="drafts-toggle"
              type="button"
              onClick={() => setDraftsExpanded((expanded) => !expanded)}
              aria-expanded={draftsExpanded}
              aria-controls={draftsId}
            >
              <ChevronDown size={14} className={draftsExpanded ? '' : 'collapsed'} />
              <span>{tr('draftsTitle')}</span>
              <span className="draft-count">{drafts.length}</span>
            </button>
            <div id={draftsId} className="drafts-list" hidden={!draftsExpanded}>
              {drafts.map((draft) => (
                <div key={draft.key} className={`draft-card${draft.isCurrent ? ' current' : ''}`}>
                  <div className="draft-meta">
                    <span className="draft-document" title={draft.documentLabel}>{draft.documentLabel}</span>
                    <span className="note-language">{tr(draft.lang === 'zh' ? 'columnChinese' : 'columnEnglish')}</span>
                  </div>
                  {draft.isEdit && <span className="draft-kind"><Pencil size={11} aria-hidden="true" />{tr('editingDraft')}</span>}
                  <blockquote className="draft-quote" lang={draft.lang === 'zh' ? 'zh-CN' : 'en'}>{draft.quote}</blockquote>
                  <p className="draft-comment">{draft.comment}</p>
                  {draft.unavailable && <p className="draft-unavailable">{tr('originalUnavailable')}</p>}
                  <button className="btn small ghost draft-resume" onClick={() => onResumeDraft(draft.key)}>
                    <Pencil size={12} /> {tr('continueDraft')}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
        {notes.length === 0 && <p className="empty-notes">{tr('emptyNotes')}</p>}
        {notes.map((note) => (
          <article key={note.id} className={`note ${activeId === note.id ? 'active' : ''}`} data-status={note.status}>
            <div className="note-meta">
              <span className={`badge ${note.status}`}>
                <NoteStatusIcon status={note.status} />
                {badgeLabel(note, ui)}
              </span>
              <span className="note-language">{tr(note.quoteLang === 'zh' ? 'columnChinese' : 'columnEnglish')}</span>
            </div>
            <button className="quote" lang={note.quoteLang === 'zh' ? 'zh-CN' : 'en'} aria-current={activeId === note.id ? 'true' : undefined} onClick={() => onJump(note)}>
              {note.quote}
            </button>
            {note.status === 'orphaned' && note.orphanReason && <p className="note-location-hint">{reasonText(ui, note.orphanReason)}</p>}
            <div className="comment">{note.comment}</div>
            <div className="foot">
              <button className="btn small ghost" onClick={() => onCopy([note])} title={tr('copyOne')} aria-label={tr('copyOne')}>
                <Copy size={13} />
              </button>
              <button className="btn small ghost" onClick={() => onEdit(note)} title={tr('editNote')} aria-label={tr('editNote')}>
                <Pencil size={13} />
              </button>
              <div className="spacer" />
              {note.status === 'resolved' ? (
                <button className="btn small ghost" onClick={() => onStatus(note.id, 'open')}>
                  <RotateCcw size={13} /> {tr('reopen')}
                </button>
              ) : (
                <button className="btn small ghost" onClick={() => onStatus(note.id, 'resolved')}>
                  <Check size={13} /> {tr('complete')}
                </button>
              )}
              <button className="btn small ghost" onClick={() => onDelete(note.id)} title={tr('delete')} aria-label={tr('delete')}>
                <Trash size={13} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  )
}

function badgeLabel(note: Note, lang: UiLang) {
  if (note.status === 'outdated') return t(lang, 'statusReview')
  if (note.status === 'orphaned') return t(lang, 'statusOrphan')
  if (note.status === 'resolved') return t(lang, 'statusResolved')
  return t(lang, 'statusOpen')
}

function NoteStatusIcon({ status }: { status: Note['status'] }) {
  const Icon = status === 'resolved' ? CircleCheck : status === 'outdated' ? RotateCcw : status === 'orphaned' ? Unlink : Circle
  return <Icon size={12} strokeWidth={1.7} aria-hidden="true" />
}
