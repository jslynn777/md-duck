import { useEffect, useId, useRef, useState } from 'react'
import type { NotesResult, ReviewCandidate } from '@shared/types'
import { errorText } from '@shared/i18n'
import { useUi } from './i18n'

export function ReviewAssociation({ sourcePath, eligible, onAssociated }: {
  sourcePath: string
  eligible: boolean
  onAssociated: (result: NotesResult, sourcePath: string) => void
}) {
  const ui = useUi()
  const zh = ui === 'zh'
  const id = useId()
  const request = useRef(0)
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    request.current += 1
    setCandidates([]); setSelected(''); setError(''); setBusy(false)
    if (eligible) void window.api.listReviewCandidates(sourcePath).then((items) => {
      if (!alive) return
      setCandidates(items)
      setSelected(items[0]?.id ?? '')
    }).catch(() => {})
    return () => { alive = false; request.current += 1 }
  }, [sourcePath, eligible])
  if (!eligible || candidates.length === 0) return null
  const candidate = candidates.find((item) => item.id === selected)
  async function associate() {
    if (!selected || busy) return
    const token = request.current
    setBusy(true); setError('')
    try { onAssociated(await window.api.associateReview(sourcePath, selected), sourcePath) }
    catch (cause) { if (token === request.current) setError(errorText(ui, cause instanceof Error ? cause.message : '', 'noteSaveFailed')) }
    finally { if (token === request.current) setBusy(false) }
  }
  return <section className="review-association banner" aria-labelledby={`${id}-title`}>
    <p id={`${id}-title`}>{zh ? '发现原文件已移走的批注或单词记录。若文章改过名，可手动关联。' : 'Review records remain for a missing file. If this article was renamed, you can link them here.'}</p>
    <div className="review-association-controls">
      <label htmlFor={`${id}-candidate`}>{zh ? '原来的文章' : 'Previous article'}</label>
      <select id={`${id}-candidate`} value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
        {candidates.map((item) => <option key={item.id} value={item.id}>{item.document}</option>)}
      </select>
      <button className="btn small ghost" disabled={busy || !selected} onClick={() => void associate()}>{busy ? (zh ? '正在关联…' : 'Linking…') : (zh ? '关联到这篇文章' : 'Link to this article')}</button>
    </div>
    {candidate && <div className="review-association-preview">
      <span>{zh ? `${candidate.noteCount} 条批注 · ${candidate.wordCount} 个单词` : `${candidate.noteCount} notes · ${candidate.wordCount} words`}</span>
      {candidate.quotes[0] && <blockquote>{candidate.quotes[0]}</blockquote>}
      <span>{zh ? '保留原记录，不改动文章内容。' : 'Original records and article text are preserved.'}</span>
    </div>}
    {error && <p className="note-error" role="alert">{error}</p>}
  </section>
}
