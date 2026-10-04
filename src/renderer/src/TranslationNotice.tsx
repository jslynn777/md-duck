import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { AI_PRESETS, type AISettings } from '@shared/ai'
import type { TranslationInfo, TranslationState } from '@shared/translation'
import type { UiLang } from '@shared/types'
import { friendlyAIError, translationError } from './ai-ui-errors'
import './ai-translation.css'

export type TranslationNoticeProps = {
  sourcePath: string
  documentVersion: number
  hasTranslation: boolean
  hasKey: boolean
  requested: boolean
  ui: UiLang
  onSettings: () => void
  onReady: () => void
  onDismiss: () => void
}

export function TranslationNotice({ sourcePath, documentVersion, hasTranslation, hasKey, requested, ui, onSettings, onReady, onDismiss }: TranslationNoticeProps) {
  const zh = ui === 'zh'
  const [info, setInfo] = useState<TranslationInfo | null>(null)
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState<'start' | 'stop' | 'choose' | null>(null)
  const [error, setError] = useState('')
  const [showCompletion, setShowCompletion] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const sourceRef = useRef(sourcePath)
  sourceRef.current = sourcePath
  const requestVersion = useRef(0)
  const eventVersion = useRef(0)
  const infoVersion = useRef(0)
  const alive = useRef(true)
  const task = info?.sourcePath === sourcePath ? info.task : null
  const running = task?.phase === 'running'
  const currentInfo = info?.sourcePath === sourcePath ? info : null
  const activeProfile = settings?.profiles[settings.provider]
  const serviceName = settings ? (settings.provider === 'custom' ? (zh ? '自定义服务' : 'Custom service') : AI_PRESETS[settings.provider].name) : ''
  const canContinue = task?.phase === 'paused' || task?.phase === 'failed'

  useEffect(() => {
    alive.current = true
    const request = ++requestVersion.current
    setInfo(null)
    setConfirm(false)
    setError('')
    setBusy(null)
    setShowCompletion(false)
    setDismissed(false)
    const unsubscribe = window.api.onTranslation((next) => {
      if (!alive.current || next.sourcePath !== sourcePath || sourceRef.current !== sourcePath) return
      eventVersion.current += 1
      setInfo((current) => current?.sourcePath === sourcePath
        ? { ...current, task: next, hasTranslation: next.phase === 'complete' || current.hasTranslation }
        : { sourcePath, targetPath: next.targetPath, hasTranslation: next.phase === 'complete', canTranslate: true, task: next })
      if (next.phase === 'running' || next.phase === 'complete') setShowCompletion(true)
      if (next.phase === 'running') { setConfirm(false); setDismissed(false); setError('') }
    })
    void window.api.getAISettings().then((next) => {
      if (alive.current && sourceRef.current === sourcePath && requestVersion.current === request) setSettings(next)
    }).catch(() => undefined)
    const unsubscribeSettings = window.api.onAISettings((next) => {
      if (alive.current) setSettings(next)
    })
    return () => {
      alive.current = false
      requestVersion.current += 1
      unsubscribe()
      unsubscribeSettings()
    }
  }, [sourcePath, ui])

  useEffect(() => {
    const request = ++infoVersion.current
    const capturedEvent = eventVersion.current
    void window.api.getTranslationInfo(sourcePath).then((next) => {
      if (!alive.current || infoVersion.current !== request || sourceRef.current !== sourcePath) return
      // File watcher snapshots must not overwrite a newer translation progress event.
      setInfo((current) => eventVersion.current !== capturedEvent && current?.sourcePath === sourcePath
        ? { ...next, task: current.task, hasTranslation: next.hasTranslation || current.hasTranslation } : next)
      if (next.task?.phase === 'running') setShowCompletion(true)
      setError('')
    }).catch((cause: unknown) => {
      if (alive.current && infoVersion.current === request && sourceRef.current === sourcePath) setError(translationError(cause, ui))
    })
    return () => { infoVersion.current += 1 }
  }, [sourcePath, documentVersion, hasTranslation, requested, ui])

  useEffect(() => { if (requested) setDismissed(false) }, [requested])
  useEffect(() => { if (!hasTranslation) setDismissed(false) }, [hasTranslation])

  function acceptTask(next: TranslationState) {
    if (next.sourcePath !== sourceRef.current) return
    setInfo((current) => ({
      sourcePath: next.sourcePath,
      targetPath: next.targetPath,
      hasTranslation: next.phase === 'complete' || !!current?.hasTranslation,
      canTranslate: current?.canTranslate ?? true,
      reason: current?.reason,
      task: next
    }))
  }
  async function begin() {
    if (busy) return
    const path = sourcePath
    const request = ++requestVersion.current
    const capturedEvent = eventVersion.current
    setBusy('start')
    setError('')
    setShowCompletion(true)
    try {
      const next = await window.api.startTranslation(path)
      if (!alive.current || path !== sourceRef.current || requestVersion.current !== request) return
      if (eventVersion.current === capturedEvent) acceptTask(next)
      setConfirm(false)
    } catch (cause) {
      if (alive.current && path === sourceRef.current && requestVersion.current === request) setError(translationError(cause, ui))
    } finally {
      if (alive.current && path === sourceRef.current && requestVersion.current === request) setBusy(null)
    }
  }
  async function stop() {
    if (busy) return
    const path = sourcePath
    const request = ++requestVersion.current
    const capturedEvent = eventVersion.current
    setBusy('stop')
    setError('')
    try {
      const next = await window.api.stopTranslation(path)
      if (!alive.current || path !== sourceRef.current || requestVersion.current !== request) return
      if (eventVersion.current === capturedEvent) acceptTask(next)
    } catch (cause) {
      if (alive.current && path === sourceRef.current && requestVersion.current === request) setError(translationError(cause, ui))
    } finally {
      if (alive.current && path === sourceRef.current && requestVersion.current === request) setBusy(null)
    }
  }
  async function choose() {
    if (busy) return
    const path = sourcePath
    const request = ++requestVersion.current
    setBusy('choose')
    setError('')
    try {
      const chosen = await window.api.chooseTranslation(path)
      if (!alive.current || path !== sourceRef.current || requestVersion.current !== request) return
      if (chosen) onReady()
    } catch (cause) {
      if (alive.current && path === sourceRef.current && requestVersion.current === request) setError(translationError(cause, ui))
    } finally {
      if (alive.current && path === sourceRef.current && requestVersion.current === request) setBusy(null)
    }
  }
  function dismiss() { setDismissed(true); setConfirm(false); onDismiss() }
  async function showConfirmation() {
    setError('')
    setConfirm(true)
    const path = sourcePath
    try {
      const next = await window.api.getAISettings()
      if (alive.current && sourceRef.current === path) setSettings(next)
    } catch (cause) {
      if (alive.current && sourceRef.current === path) setError(friendlyAIError(cause, ui))
    }
  }

  if (dismissed && !running) return null
  if ((hasTranslation || currentInfo?.hasTranslation) && !(task?.phase === 'complete' && (showCompletion || requested)) && task?.phase !== 'stale') return null
  if (!requested && !hasKey && !task) return null
  if (!currentInfo && !error) return requested ? <div className="translation-notice translation-loading" role="status"><LoaderCircle className="spin" size={14} />{zh ? '正在检查对应译文…' : 'Checking for a translation…'}</div> : null
  if (currentInfo && !currentInfo.canTranslate && !requested && !task) return null

  const progress = task ? (zh ? `已完成 ${task.completed} / ${task.total} 段` : `${task.completed} / ${task.total} sections completed`) : ''
  const errorMessage = error || (task?.phase === 'failed' ? translationError(task.error, ui) : '')
  let message: string
  if (running) message = zh ? `正在翻译 · ${progress}` : `Translating · ${progress}`
  else if (task?.phase === 'complete') message = zh ? '中文译文已保存，可以打开对照阅读。' : 'Chinese translation saved. Ready to read side by side.'
  else if (task?.phase === 'stale') message = hasTranslation || currentInfo?.hasTranslation ? (zh ? '原文已更新，已有译文可能需要同步修改。' : 'The source was updated. The existing translation may need to be updated too.') : (zh ? '原文已变化，需要按最新原文重新翻译。' : 'The source has changed. Start a new translation from the updated article.')
  else if (task?.phase === 'paused') message = zh ? `翻译已暂停 · ${progress}` : `Translation paused · ${progress}`
  else if (task?.phase === 'failed') message = zh ? `翻译未完成 · ${progress}` : `Translation unfinished · ${progress}`
  else if (currentInfo?.reason === 'chinese') message = zh ? '这篇文章已是中文，可选择对应的另一份语言文件。' : 'This article is already in Chinese. Choose its counterpart to read side by side.'
  else if (currentInfo?.reason === 'empty') message = zh ? '文章还没有可以翻译的内容。' : 'This article has no content to translate yet.'
  else if (currentInfo?.reason === 'unsupported') message = zh ? '当前文件无法自动翻译，可选择已有译文。' : 'This file cannot be translated automatically. You can choose an existing translation.'
  else if (currentInfo?.reason === 'target-exists') message = zh ? '同名译文文件已存在，可选择并关联它。' : 'A translation file already exists. Choose it to link it with this article.'
  else message = zh ? '这篇文章还没有中文译文。' : 'This article has no Chinese translation yet.'

  return <aside className="translation-notice" aria-label={zh ? '文章翻译' : 'Article translation'}>
    <div className="translation-notice-row">
      <span className="translation-message" role="status">{running && <LoaderCircle size={14} className="spin" />}{message}</span>
      <div className="translation-actions">
        {running ? <button type="button" className="ai-text-button" onClick={() => void stop()} disabled={!!busy}>{busy === 'stop' ? (zh ? '正在停止…' : 'Stopping…') : (zh ? '停止' : 'Stop')}</button>
          : task?.phase === 'complete' ? <button type="button" className="ai-text-button" onClick={() => { setDismissed(true); onReady() }}>{zh ? '打开对照' : 'Open side by side'}</button>
          : <>
            {hasKey && currentInfo?.canTranslate && !confirm && <button type="button" className="ai-text-button" onClick={() => void showConfirmation()} disabled={!!busy}>{canContinue ? (zh ? '继续翻译' : 'Resume translation') : task?.phase === 'stale' ? (zh ? '重新翻译' : 'Translate again') : (zh ? '生成中文译文' : 'Generate Chinese translation')}</button>}
            {!hasKey && (requested || !!task) && <button type="button" className="ai-text-button" onClick={onSettings}>{zh ? '连接 AI' : 'Connect AI'}</button>}
            {!confirm && <button type="button" className="ai-text-button" onClick={() => void choose()} disabled={!!busy}>{busy === 'choose' ? (zh ? '正在选择…' : 'Choosing…') : (zh ? '选择已有译文' : 'Choose a translation')}</button>}
          </>}
        {!running && <button type="button" className="translation-dismiss" onClick={dismiss} disabled={!!busy} aria-label={zh ? '关闭翻译提示' : 'Dismiss translation notice'} title={zh ? '关闭' : 'Dismiss'}><X size={15} /></button>}
      </div>
    </div>
    {running && task && task.total > 0 && <progress className="translation-progress" value={task.completed} max={task.total} aria-label={progress} />}
    {task?.phase === 'paused' && <p className="translation-detail">{zh ? '进度已保存在本机，下次打开仍可继续。' : 'Progress is saved on this device. You can continue after reopening the app.'}</p>}
    {task?.phase === 'stale' && <p className="translation-detail">{hasTranslation || currentInfo?.hasTranslation ? (zh ? '现有译文已保留，不会自动覆盖。你可以选择另一份已更新的译文。' : 'The existing translation is kept and will not be overwritten automatically. You can choose an updated translation file.') : (zh ? '已完成的旧段落不会混入新译文，重新翻译会使用最新原文。' : 'Old translated sections will not be mixed into the new translation. Translation will use the latest source.')}</p>}
    {errorMessage && <div className="translation-error" role="alert"><span>{errorMessage}</span><button type="button" className="ai-text-button" onClick={onSettings}>{zh ? '检查 AI 设置' : 'Check AI settings'}</button></div>}
    {confirm && !running && task?.phase !== 'complete' && <div className="translation-confirm">
      <p>{settings ? (zh ? `将使用 ${serviceName} · ${activeProfile?.model || ''}。` : `Using ${serviceName} · ${activeProfile?.model || ''}.`) : (zh ? '正在读取 AI 服务设置…' : 'Loading AI service settings…')}</p>
      <p>{zh ? '文章正文将发送到你选择的 AI 服务，费用从你的服务账户扣除。译文会另存为中文 Markdown 文件，保留原文。' : 'The article text will be sent to your selected AI service and billed to your account. The Chinese translation is saved as a separate Markdown file; the source is kept.'}</p>
      {task && task.completed > 0 && canContinue && <p>{zh ? `已保存 ${task.completed} 段的进度；使用相同服务和模型时可继续，更换服务或模型后会重新翻译。` : `${task.completed} sections are saved. The same service and model can resume; changing either starts a new translation.`}</p>}
      <div className="ai-actions"><button type="button" className="ai-button ai-button-primary" onClick={() => void begin()} disabled={!!busy || !settings || !activeProfile?.hasKey}>{busy === 'start' && <LoaderCircle size={14} className="spin" />}{busy === 'start' ? (zh ? '正在开始…' : 'Starting…') : canContinue ? (zh ? '继续翻译' : 'Resume translation') : (zh ? '开始翻译' : 'Start translation')}</button><button type="button" className="ai-text-button" onClick={() => setConfirm(false)} disabled={!!busy}>{zh ? '取消' : 'Cancel'}</button></div>
    </div>}
  </aside>
}
