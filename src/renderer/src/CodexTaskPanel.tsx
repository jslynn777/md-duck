import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, ChevronDown, Copy, LoaderCircle, RefreshCw, Send, Square, X } from 'lucide-react'
import type { CodexApproval, CodexApprovalResponse, CodexTask, CodexTaskInput, CodexTaskPhase, CodexTaskSnapshot } from '../../shared/codex-task'
import { codexTaskIsActive } from '../../shared/codex-task'
import { codexRootsMatch } from './useCodexTasks'
import type { UiLang } from '../../shared/types'
import type { SpaceSummary } from '../../shared/spaces'
import './codex-task.css'

const labels: Record<CodexTaskPhase, [string, string]> = {
  starting: ['正在连接 Codex', 'Connecting to Codex'], running: ['正在处理', 'Working'],
  'waiting-approval': ['需要你的批准', 'Approval needed'], 'waiting-input': ['需要你的回答', 'Your answer is needed'],
  review: ['已完成，待你审阅', 'Ready for your review'], stopping: ['正在停止', 'Stopping'],
  stopped: ['已停止', 'Stopped'], 'taken-over': ['已由你接管', 'You took over'],
  failed: ['任务未完成', 'Task failed'], disconnected: ['连接中断，状态未知', 'Disconnected; status unknown']
}
export function codexPhaseLabel(phase: CodexTaskPhase, ui: UiLang): string { return labels[phase][ui === 'zh' ? 0 : 1] }

export function codexErrorCopy(error: string, ui: UiLang): string {
  const zh = ui === 'zh'
  if (/WINDOWS.*SANDBOX|SANDBOX.*(?:SETUP|WINDOWS)/i.test(error)) return zh ? '请先在 Codex 完成 Windows 沙箱设置。' : 'Complete Windows sandbox setup in Codex first.'
  if (/NOT_INSTALLED|NOT_FOUND|EXECUTABLE/i.test(error)) return zh ? '没有找到本机 Codex，请先安装后重新检查。' : 'Local Codex was not found. Install it, then check again.'
  if (/LOGIN|LOGGED|AUTH/i.test(error)) return zh ? '请先在本机 Codex 登录，再重新检查。' : 'Sign in to local Codex, then check again.'
  if (/SPACE_CHANGED|SPACE_MISMATCH/i.test(error)) return zh ? '当前空间已经切换，请在目标空间重新操作。' : 'The current space changed. Try again in the intended space.'
  if (/STOP_UNCONFIRMED/i.test(error)) return zh ? '尚未确认任务已经停止，请重新检查状态后再接管。' : 'The task has not confirmed that it stopped. Check its state before taking over.'
  if (/CHANGE_CHECK|SNAPSHOT/i.test(error)) return zh ? '暂时无法完整核对文件更新，请回到文章列表查看改动。已保存的内容仍保留。' : 'The updated-file list could not be fully checked. Review changes in the article list; saved content is preserved.'
  if (/ROOT_CHANGED|ERR_CODEX_ROOT/i.test(error)) return zh ? '空间文件夹已变化，请重新打开目标空间后开始任务。' : 'The space folder changed. Reopen the intended space before starting a task.'
  if (/ERR_CODEX_CONFIG|ERR_CODEX_STORAGE/i.test(error)) return zh ? '本地任务记录暂时无法读取或保存，请检查文件访问权限。' : 'Local task records could not be read or saved. Check file access.'
  if (/ERR_CODEX_CANCELED/i.test(error)) return zh ? '这次操作已取消。' : 'This operation was canceled.'
  if (/BUSY|ACTIVE|RUNNING/i.test(error)) return zh ? '这个空间的任务还在处理，请稍候，或先停止当前任务。' : 'This space has an active operation. Wait, or stop the current task first.'
  if (/APPROVAL|QUESTION|REQUEST_EXPIRED/i.test(error)) return zh ? '这项请求已更新，请重新检查任务状态。' : 'This request has changed. Check the latest task state.'
  if (/PROMPT|INPUT|EMPTY/i.test(error)) return zh ? '请填写这次任务的具体要求后再提交。' : 'Enter what you want this task to do before submitting.'
  if (/DISCONNECT|TIMEOUT|EXITED|CLOSED/i.test(error)) return zh ? '与 Codex 的连接已中断，任务状态尚未确认。请重新检查连接。' : 'The Codex connection was interrupted; task state is unconfirmed. Check the connection again.'
  return zh ? '这次操作未完成，请检查 Codex 的连接状态后重试。' : 'This operation did not finish. Check the Codex connection and try again.'
}

export function codexActivityCopy(activity: string, ui: UiLang): string {
  const copy: Record<string, [string, string]> = {
    starting: ['正在准备本地任务', 'Preparing the local task'], working: ['正在分析任务', 'Considering the task'], running: ['正在处理任务', 'Working on the task'],
    'waiting-approval': ['等待你的批准', 'Waiting for your approval'], 'waiting-input': ['等待你的回答', 'Waiting for your answer'],
    'running-command': ['正在执行任务命令', 'Running a task command'], 'command-finished': ['任务命令已完成', 'Task command finished'],
    'editing-files': ['正在修改空间里的文件', 'Editing files in this space'], 'files-updated': ['文件已更新', 'Files updated'],
    'checking-changes': ['正在核对保存结果', 'Checking saved changes'],
    'using-tool': ['正在使用任务工具', 'Using a task tool'], 'awaiting-review': ['修改已完成，请检查文章', 'Changes are ready for you to review'],
    stopping: ['正在停止当前任务', 'Stopping the current task'], stopped: ['任务已停止', 'The task has stopped'],
    'taken-over': ['已停止任务，可以由你继续操作', 'The task has stopped; you can continue editing']
  }
  return copy[activity]?.[ui === 'zh' ? 0 : 1] ?? ''
}

type Props = {
  open: boolean
  ui: UiLang
  space: SpaceSummary
  relativePath?: string
  snapshot: CodexTaskSnapshot | null
  loading: boolean
  busy: boolean
  controlBusy?: boolean
  replyBusy?: boolean
  error: string
  onClose: () => void
  onRefresh: () => void
  onStart: (input: CodexTaskInput) => Promise<void>
  onStop: () => Promise<void>
  onRespond: (response: CodexApprovalResponse) => Promise<void>
  onTakeover?: () => Promise<void>
  onReview: (relativePath: string) => void
  onContext: () => void
}

export function CodexTaskPanel({ open, ui, space, relativePath, snapshot, loading, busy, controlBusy = busy, replyBusy = busy, error, onClose, onRefresh, onStart, onStop, onRespond, onTakeover, onReview, onContext }: Props) {
  const zh = ui === 'zh'
  const closeButton = useRef<HTMLButtonElement>(null)
  const currentSpace = useRef(space.id)
  currentSpace.current = space.id
  const [drafts, setDrafts] = useState<Record<string, string>>({}), [articleOnly, setArticleOnly] = useState(true)
  const [actionError, setActionError] = useState('')
  const draft = drafts[space.id] ?? ''
  const scopedSnapshot = snapshot?.spaceId === space.id && codexRootsMatch(snapshot.root, space.root) ? snapshot : null
  const task = scopedSnapshot?.task ?? null
  const active = codexTaskIsActive(task)
  const available = scopedSnapshot?.availability.state === 'ready'
  const activity = task ? codexActivityCopy(task.activity, ui) : ''
  useEffect(() => { if (open) closeButton.current?.focus() }, [open])
  useEffect(() => { setActionError(''); setArticleOnly(true) }, [space.id])
  if (!open) return null
  async function run(action: () => Promise<void>, blocked = busy) {
    if (blocked) return
    const requestedSpace = space.id
    setActionError('')
    try { await action() } catch (reason) { if (currentSpace.current === requestedSpace) setActionError(reason instanceof Error ? reason.message : String(reason)) }
  }
  return <aside className="codex-task-panel" role="complementary" aria-label={zh ? 'Codex 空间任务' : 'Codex space task'} onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }}>
    <header className="codex-panel-heading"><div><h2>Codex</h2><span>{space.name}</span></div><button ref={closeButton} className="btn icon ghost" onClick={onClose} aria-label={zh ? '收起任务面板' : 'Close task panel'}><X size={17} /></button></header>
    <div className="codex-panel-body">
      <p className="codex-working-directory" title={space.root}>{zh ? '工作目录' : 'Working folder'}<span>{space.root}</span></p>
      {loading && (!scopedSnapshot || scopedSnapshot.availability.state === 'unknown') ? <p className="codex-panel-status" role="status"><LoaderCircle className="spin" size={15} />{zh ? '正在检查本机 Codex…' : 'Checking local Codex…'}</p> : !available && <div className="codex-availability">
        <p>{/WINDOWS.*SANDBOX|SANDBOX.*(?:SETUP|WINDOWS)/i.test(scopedSnapshot?.availability.message ?? '') ? (zh ? '请先在 Codex 完成 Windows 沙箱设置。' : 'Complete Windows sandbox setup in Codex first.') : scopedSnapshot?.availability.state === 'not-installed' ? (zh ? '还没有找到本机 Codex。' : 'Local Codex was not found.')
          : scopedSnapshot?.availability.state === 'not-logged-in' ? (zh ? '请先在本机 Codex 登录，再回来开始任务。' : 'Sign in to Codex on this computer, then return to start a task.')
            : scopedSnapshot?.availability.state === 'unsupported' ? (zh ? '当前 Codex 版本暂不支持本地任务，请更新后重试。' : 'This Codex version does not support local tasks. Update it and try again.')
              : (zh ? '暂时无法连接本机 Codex。' : 'Local Codex is not available yet.')}</p>
        {scopedSnapshot?.availability.message && <details className="codex-error-details"><summary>{zh ? '查看连接详情' : 'Connection details'}</summary><pre>{scopedSnapshot.availability.message}</pre></details>}
        <button className="btn small ghost" disabled={loading} onClick={onRefresh}><RefreshCw size={14} />{zh ? '重新检查' : 'Check again'}</button>
      </div>}

      {task && <div className="codex-current-task">
        <div className="codex-task-phase" data-phase={task.phase} role="status">{active ? <LoaderCircle size={15} className={task.phase === 'running' || task.phase === 'starting' || task.phase === 'stopping' ? 'spin' : ''} /> : task.phase === 'review' ? <Check size={15} /> : null}<strong>{codexPhaseLabel(task.phase, ui)}</strong></div>
        <p className="codex-task-prompt">{task.prompt}</p>
        {scopedSnapshot && !codexRootsMatch(task.root, scopedSnapshot.root) && <p className="codex-review-note">{zh ? '这是旧文件夹位置的任务记录。新的要求会在当前空间位置另开任务。' : 'This task belongs to the previous folder location. New instructions will start a task in the current folder.'}</p>}
        {activity && <p className="codex-task-activity">{activity}</p>}
        {task.error && <TaskError error={task.error} ui={ui} />}
        <TaskMessages task={task} ui={ui} />
        {task.changedFiles.length > 0 && <div className="codex-changed-files"><h3>{zh ? '任务期间更新' : 'Files updated during this task'}<span>{task.changedFiles.length}</span></h3><p className="codex-review-note">{zh ? '这段时间其他编辑器保存的文件也可能计入。' : 'Files saved by other editors during this time may also be included.'}</p>{task.changedFiles.map(path => <button key={path} type="button" onClick={() => onReview(path)} title={path}><span>{path}</span><ArrowUpRight size={13} /></button>)}</div>}
        {task.phase === 'review' && <p className="codex-review-note">{zh ? '回到文章检查内容。是否接受修改，由你审阅后决定。' : 'Return to the article to review the changes.'}</p>}
        {active && <div className="codex-task-controls"><button className="btn small ghost" disabled={controlBusy || task.phase === 'stopping'} onClick={() => void run(onStop, controlBusy)}><Square size={12} />{zh ? '停止任务' : 'Stop task'}</button>{onTakeover && <button className="btn small ghost" disabled={controlBusy || task.phase === 'stopping'} onClick={() => void run(onTakeover, controlBusy)}>{zh ? '我来接管' : 'Take over'}<ArrowUpRight size={13} /></button>}</div>}
        {(task.phase === 'stopped' || task.phase === 'taken-over') && <p className="codex-review-note">{zh ? '任务已停止。已经写入的内容仍保留，请在文章中检查。' : 'The task has stopped. Changes already written remain in your files for review.'}</p>}
      </div>}

      {scopedSnapshot?.approvals.map(approval => <TaskApproval key={approval.id} approval={approval} ui={ui} busy={replyBusy} onRespond={response => run(() => onRespond(response), replyBusy)} />)}
      {!active && <form className="codex-task-form" onSubmit={event => { event.preventDefault(); if (!draft.trim() || !available || busy) return; void run(async () => { await onStart({ prompt: draft.trim(), relativePath: articleOnly ? relativePath : undefined }); setDrafts(current => ({ ...current, [space.id]: '' })) }) }}>
        <label htmlFor="codex-task-prompt">{zh ? (task ? '接下来想做什么？' : '想让 Codex 做什么？') : (task ? 'What next?' : 'What should Codex do?')}</label>
        <textarea id="codex-task-prompt" value={draft} disabled={busy} maxLength={12000} placeholder={zh ? '例如：把这篇文章的选材建议写得更具体，保留其他段落。' : 'For example: make the material recommendations more specific, keeping the other paragraphs.'} onChange={event => setDrafts(current => ({ ...current, [space.id]: event.target.value }))} />
        {relativePath && <label className="codex-article-scope"><input type="checkbox" checked={articleOnly} disabled={busy} onChange={event => setArticleOnly(event.target.checked)} /><span>{zh ? '带上当前文章' : 'Include current article'}<small title={relativePath}>{relativePath}</small></span></label>}
        <button type="submit" className="btn primary" disabled={!available || busy || !draft.trim()}><Send size={14} />{busy ? (zh ? '正在提交…' : 'Submitting…') : zh ? '开始本地任务' : 'Start local task'}</button>
      </form>}
      {(error || actionError) && <TaskError error={actionError || error} ui={ui} />}
    </div>
    <footer className="codex-panel-footer"><button className="btn small ghost" onClick={onContext}><Copy size={13} />{zh ? '其他 AI 的空间说明' : 'Instructions for other AI'}</button><span>{zh ? '文章始终保存在本地' : 'Articles stay in your folder'}</span></footer>
  </aside>
}

function TaskMessages({ task, ui }: { task: CodexTask; ui: UiLang }) {
  if (!task.messages.length && !task.activity) return null
  return <details className="codex-task-messages"><summary>{ui === 'zh' ? '查看任务过程' : 'Task activity'}<ChevronDown size={14} /></summary>{task.activity && <pre>{task.activity}</pre>}<ol>{task.messages.slice(-30).map(message => <li key={message.id} data-kind={message.kind}><span>{message.kind === 'command' ? (ui === 'zh' ? '命令' : 'Command') : message.kind === 'file-change' ? (ui === 'zh' ? '文件改动' : 'File change') : 'Codex'}</span><pre>{message.text}</pre></li>)}</ol></details>
}

function TaskError({ error, ui }: { error: string; ui: UiLang }) {
  return <div className="codex-task-error" role="alert"><p>{codexErrorCopy(error, ui)}</p><details className="codex-error-details"><summary>{ui === 'zh' ? '查看详情' : 'Details'}</summary><pre>{error}</pre></details></div>
}

function TaskApproval({ approval, ui, busy, onRespond }: { approval: CodexApproval; ui: UiLang; busy: boolean; onRespond: (response: CodexApprovalResponse) => Promise<void> }) {
  const zh = ui === 'zh', [answers, setAnswers] = useState<Record<string, string>>({})
  const questions = approval.questions ?? []
  const canAnswer = questions.length > 0 && questions.every(question => answers[question.id]?.trim())
  return <section className="codex-approval" aria-label={zh ? 'Codex 需要确认' : 'Codex needs your input'}><h3>{approval.kind === 'question' ? (zh ? '请回答后继续' : 'Answer to continue') : (zh ? '这一步需要你批准' : 'Approval needed')}</h3>
    {approval.reason && <p>{approval.reason}</p>}{approval.command && <pre>{approval.command}</pre>}{approval.cwd && <p className="codex-approval-path">{approval.cwd}</p>}
    {approval.files?.map(file => <details key={file.path} className="codex-approval-diff"><summary>{file.path}</summary><pre>{file.diff || (zh ? 'Codex 未提供此文件的差异内容。' : 'Codex did not provide a diff for this file.')}</pre></details>)}
    {questions.map(question => <fieldset key={question.id}><legend>{question.question}</legend>{question.options?.map(option => <label className="codex-question-option" key={option.label}><input type="radio" name={`${approval.id}:${question.id}`} value={option.label} checked={answers[question.id] === option.label} disabled={busy} onChange={() => setAnswers(current => ({ ...current, [question.id]: option.label }))} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>)}<input className="codex-question-input" type={question.isSecret ? 'password' : 'text'} aria-label={question.question} value={answers[question.id] ?? ''} disabled={busy} placeholder={zh ? '输入回答' : 'Your answer'} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} /></fieldset>)}
    <div className="codex-approval-actions">{approval.kind === 'question' ? <button className="btn small primary" disabled={busy || !canAnswer} onClick={() => void onRespond({ id: approval.id, answers: Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, [answer]])) })}>{zh ? '提交回答' : 'Submit answer'}</button> : <><button className="btn small primary" disabled={busy} onClick={() => void onRespond({ id: approval.id, decision: 'approve' })}>{zh ? '批准这一次' : 'Approve once'}</button><button className="btn small ghost" disabled={busy} onClick={() => void onRespond({ id: approval.id, decision: 'decline' })}>{zh ? '拒绝' : 'Decline'}</button></>}</div>
  </section>
}
