import { useEffect, useId, useRef } from 'react'
import type { PairingIssue, PairingLocation, PairingReport } from '../../shared/pairing-diagnostics'
import type { UiLang } from '../../shared/types'
import { pairingCoverage, pairingEmptyCopy, pairingFileName, pairingIssueCopy, pairingLocationLabel, pairingStatusCopy } from './pairing-copy'

export function PairingStatus({ report, ui, onCheck }: {
  report: PairingReport
  ui: UiLang
  onCheck: () => void
}) {
  const copy = pairingStatusCopy(report, ui)
  return <div className="pairing-status">
    <div className="pairing-status-copy" role="status">
      <span>{copy.summary}</span>
      <span className="pairing-status-detail">{copy.detail}</span>
    </div>
    <button type="button" className="pairing-check-link" onClick={onCheck}>{ui === 'zh' ? '检查整篇' : 'Check whole document'}</button>
  </div>
}

export function PairingCheckDialog({ report, ui, sourcePath, zhPath, onClose, onLocate }: {
  report: PairingReport
  ui: UiLang
  sourcePath: string
  zhPath?: string | null
  onClose: () => void
  onLocate: (location: PairingLocation) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const zh = ui === 'zh'
  const copy = pairingStatusCopy(report, ui)
  const warnings = report.issues.filter((issue) => issue.severity === 'warning').length
  const information = report.issues.length - warnings
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  const close = () => dialogRef.current?.close()
  const locate = (location: PairingLocation) => {
    if (!location.blockKey) return
    close()
    onLocate(location)
  }
  const renderLocation = (issue: PairingIssue, location: PairingLocation | undefined) => {
    if (!location) return null
    const label = pairingLocationLabel(issue, location, ui)
    return location.blockKey ? <button type="button" className="pairing-location" onClick={() => locate(location)}>
      {label}<span aria-hidden="true"> ↗</span>
    </button> : <span className="pairing-location-static">{label}</span>
  }
  return <dialog ref={dialogRef} className="pairing-dialog" lang={zh ? 'zh-CN' : 'en'} aria-labelledby={titleId}
    aria-describedby={descriptionId} onClose={onClose} onCancel={(event) => { event.preventDefault(); close() }}
    onPointerDown={(event) => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
    }}>
    <header className="pairing-dialog-heading">
      <h2 id={titleId}>{zh ? '整篇配对检查' : 'Whole-document pairing check'}</h2>
      <button type="button" className="pairing-dialog-close" aria-label={zh ? '关闭配对检查' : 'Close pairing check'} autoFocus onClick={close}>×</button>
    </header>
    <div className="pairing-dialog-body">
      <p className="pairing-coverage">{pairingCoverage(report, ui)}</p>
      <p className="pairing-reading">{copy.detail}</p>
      <dl className="pairing-files">
        <div><dt>{zh ? '原文' : 'Source'}</dt><dd title={sourcePath}>{pairingFileName(sourcePath)}</dd></div>
        <div><dt>{zh ? '中文' : 'Chinese'}</dt><dd title={zhPath ?? undefined}>{zhPath ? pairingFileName(zhPath) : zh ? '未提供' : 'Not available'}</dd></div>
      </dl>
      <p id={descriptionId} className="pairing-explanation">{zh ? '仅检查标记和 Markdown 结构，不判断翻译是否准确。检查不会更改文件或阅读方式。' :
        'This checks markers and Markdown structure, not translation accuracy. Files and reading behavior remain unchanged.'}</p>
      {report.issues.length > 0 ? <>
        <p className="pairing-issue-count">{zh ? `${warnings} 项需检查 · ${information} 项信息提示` : `${warnings} to inspect · ${information} informational`}</p>
        <ol className="pairing-issues">
          {report.issues.map((issue) => {
            const issueCopy = pairingIssueCopy(issue, ui)
            return <li key={issue.id} className={`pairing-issue pairing-issue-${issue.severity}`}>
              <div className="pairing-issue-heading">
                <span className="pairing-issue-label">{issue.severity === 'info' ? zh ? '提示' : 'Info' : zh ? '需检查' : 'Inspect'}</span>
                <h3>{issueCopy.title}</h3>
              </div>
              <p>{issueCopy.detail}</p>
              {(issue.source || issue.zh) && <div className="pairing-locations">
                {renderLocation(issue, issue.source)}{renderLocation(issue, issue.zh)}
              </div>}
            </li>
          })}
        </ol>
      </> : <p className="pairing-empty">{pairingEmptyCopy(report, ui)}</p>}
    </div>
    <footer className="pairing-dialog-footer"><button type="button" className="btn small ghost" onClick={close}>{zh ? '返回阅读' : 'Back to reading'}</button></footer>
  </dialog>
}
