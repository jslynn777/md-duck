import { useEffect, useId, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { AI_PRESETS, type AIProvider, type AISettings as AISettingsValue } from '@shared/ai'
import type { UiLang } from '@shared/types'
import { friendlyAIError } from './ai-ui-errors'
import './ai-translation.css'

export type AISettingsProps = {
  value: AISettingsValue | null
  onChange: (value: AISettingsValue) => void
  ui: UiLang
  /** Only state flags cross the modal boundary; unsaved keys stay in this component. */
  onDraftStateChange?: (state: { dirty: boolean; busy: boolean }) => void
}

type BusyAction = 'save' | 'test' | 'auth' | 'clear' | null

export function AISettings({ value, onChange, ui, onDraftStateChange }: AISettingsProps) {
  const zh = ui === 'zh'
  const id = useId()
  const [settings, setSettings] = useState(value)
  const [provider, setProvider] = useState<AIProvider>(value?.provider ?? 'openrouter')
  const [key, setKey] = useState('')
  const [model, setModel] = useState(value?.profiles[value.provider].model ?? AI_PRESETS.openrouter.model)
  const [baseUrl, setBaseUrl] = useState(value?.profiles[value.provider].baseUrl ?? AI_PRESETS.openrouter.baseUrl)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [error, setError] = useState('')
  const [help, setHelp] = useState(false)
  const [pendingProvider, setPendingProvider] = useState<AIProvider | null>(null)
  const version = useRef(0)
  const alive = useRef(true)
  const busyRef = useRef<BusyAction>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onDraftStateRef = useRef(onDraftStateChange)
  onDraftStateRef.current = onDraftStateChange
  const profile = settings?.profiles[provider]
  const fieldsChanged = !!settings && (!!key.trim() || model.trim() !== profile?.model || baseUrl.trim() !== profile?.baseUrl)
  const draftChanged = !!settings && (fieldsChanged || provider !== settings.provider)
  const blocked = busy !== null && busy !== 'auth'

  useEffect(() => { onDraftStateRef.current?.({ dirty: draftChanged, busy: blocked }) }, [draftChanged, blocked])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      version.current += 1
      if (busyRef.current === 'auth') void window.api.cancelAIAuth().catch(() => undefined)
    }
  }, [])

  useEffect(() => { if (value) setSettings(value) }, [value])

  useEffect(() => {
    if (value) return
    const request = ++version.current
    void window.api.getAISettings().then((next) => {
      if (!alive.current || request !== version.current) return
      setSettings(next)
      setProvider(next.provider)
      setModel(next.profiles[next.provider].model)
      setBaseUrl(next.profiles[next.provider].baseUrl)
      onChangeRef.current(next)
    }).catch((cause: unknown) => {
      if (alive.current && request === version.current) setError(friendlyAIError(cause, ui))
    })
  }, [value, ui])

  function setAction(action: BusyAction) { busyRef.current = action; setBusy(action) }
  function accept(next: AISettingsValue) {
    setSettings(next)
    onChangeRef.current(next)
  }
  function selectProvider(next: AIProvider, discard = false) {
    if (blocked || next === provider) return
    if (fieldsChanged && !discard) { setPendingProvider(next); return }
    setPendingProvider(null)
    version.current += 1
    if (busyRef.current === 'auth') void window.api.cancelAIAuth().catch(() => undefined)
    setAction(null)
    setProvider(next)
    setKey('')
    setError('')
    setModel(settings?.profiles[next].model ?? AI_PRESETS[next].model)
    setBaseUrl(settings?.profiles[next].baseUrl ?? AI_PRESETS[next].baseUrl)
  }
  async function save() {
    const request = ++version.current
    setError('')
    setAction('save')
    try {
      const next = await window.api.saveAISettings({ provider, model: model.trim(), baseUrl: baseUrl.trim(), ...(key.trim() ? { key: key.trim() } : {}) })
      if (!alive.current || request !== version.current) return
      accept(next)
      setPendingProvider(null)
      setKey('')
      setModel(next.profiles[provider].model)
      setBaseUrl(next.profiles[provider].baseUrl)
    } catch (cause) {
      if (alive.current && request === version.current) setError(friendlyAIError(cause, ui))
    } finally {
      if (alive.current && request === version.current) setAction(null)
    }
  }
  async function test() {
    if (draftChanged || !profile?.hasKey) return
    const request = ++version.current
    setError('')
    setAction('test')
    try {
      const tested = await window.api.testAIConnection()
      if (!alive.current || request !== version.current) return
      accept(tested)
    } catch (cause) {
      if (alive.current && request === version.current) setError(friendlyAIError(cause, ui))
    } finally {
      if (alive.current && request === version.current) setAction(null)
    }
  }
  async function clearKey() {
    const request = ++version.current
    setError('')
    setAction('clear')
    try {
      const next = await window.api.saveAISettings({ provider, model: profile?.model || AI_PRESETS[provider].model, baseUrl: profile?.baseUrl || AI_PRESETS[provider].baseUrl, key: null })
      if (!alive.current || request !== version.current) return
      accept(next)
      setKey('')
      setModel(next.profiles[provider].model)
      setBaseUrl(next.profiles[provider].baseUrl)
    } catch (cause) {
      if (alive.current && request === version.current) setError(friendlyAIError(cause, ui))
    } finally {
      if (alive.current && request === version.current) setAction(null)
    }
  }
  async function connect() {
    const request = ++version.current
    setError('')
    setAction('auth')
    try {
      const next = await window.api.connectOpenRouter()
      if (!alive.current || request !== version.current) return
      accept(next)
      setKey('')
      setProvider(next.provider)
      setModel(next.profiles[next.provider].model)
      setBaseUrl(next.profiles[next.provider].baseUrl)
    } catch (cause) {
      if (alive.current && request === version.current) setError(friendlyAIError(cause, ui))
    } finally {
      if (alive.current && request === version.current) setAction(null)
    }
  }
  function cancelAuth() {
    version.current += 1
    setAction(null)
    void window.api.cancelAIAuth().catch((cause: unknown) => { if (alive.current) setError(friendlyAIError(cause, ui)) })
  }
  function openLink(url: string) {
    void window.api.openExternal(url).catch((cause: unknown) => { if (alive.current) setError(friendlyAIError(cause, ui)) })
  }

  const status = draftChanged
    ? (zh ? '修改尚未保存。' : 'Changes are not saved yet.')
    : profile?.status === 'connected'
      ? (zh ? '连接可用。' : 'Connection verified.')
      : profile?.hasKey
        ? profile.status === 'error'
          ? friendlyAIError(profile.error || (zh ? '连接失败，请重试。' : 'Connection failed. Please try again.'), ui)
          : (zh ? '密钥已保存，尚未验证连接。' : 'Key saved. Connection has not been tested.')
        : (zh ? '尚未连接，可使用自己的服务账号。' : 'Not connected. Use your own service account.')
  const visibleError = error || (!draftChanged && profile?.status === 'error' ? friendlyAIError(profile.error, ui) : '')

  return <section className="ai-settings" aria-labelledby={`${id}-title`}>
    <div className="ai-settings-heading"><h3 id={`${id}-title`}>{zh ? 'AI 服务' : 'AI service'}</h3><span>{zh ? '用于查词解释和文章翻译' : 'For word explanations and article translation'}</span></div>
    <label htmlFor={`${id}-provider`}>{zh ? '选择服务' : 'Choose a service'}</label>
    <select id={`${id}-provider`} value={provider} disabled={blocked} onChange={(event) => selectProvider(event.target.value as AIProvider)}>
      <option value="openrouter">OpenRouter</option><option value="deepseek">DeepSeek</option><option value="custom">{zh ? '自定义服务（兼容 OpenAI）' : 'Custom service (OpenAI compatible)'}</option>
    </select>
    {pendingProvider && <div className="ai-help" role="alert">
      <p>{zh ? '当前配置尚未保存。切换服务会放弃这些修改。' : 'This configuration has unsaved changes. Switching services will discard them.'}</p>
      <div className="ai-actions">
        <button type="button" className="ai-button" onClick={() => setPendingProvider(null)}>{zh ? '继续编辑' : 'Keep editing'}</button>
        <button type="button" className="ai-text-button" onClick={() => selectProvider(pendingProvider, true)}>{zh ? '放弃修改并切换' : 'Discard and switch'}</button>
      </div>
    </div>}
    {provider === 'openrouter' && <div className="ai-auth-row">
      <button type="button" className="ai-button" disabled={busy !== null} onClick={() => void connect()}>{busy === 'auth' ? <><LoaderCircle size={14} className="spin" />{zh ? '等待浏览器授权…' : 'Waiting for browser authorization…'}</> : (zh ? '在浏览器中连接 OpenRouter' : 'Connect OpenRouter in browser')}</button>
      {busy === 'auth' && <button type="button" className="ai-text-button" onClick={cancelAuth}>{zh ? '取消' : 'Cancel'}</button>}
      <p className="ai-hint">{zh ? '登录并授权，无需手动复制密钥；使用你自己的账户额度。' : 'Sign in and authorize without copying a key. Uses your account credit.'}</p>
    </div>}
    <label htmlFor={`${id}-key`}>{provider === 'openrouter' ? (zh ? '或使用 API 密钥' : 'Or use an API key') : (zh ? 'API 密钥' : 'API key')}</label>
    <input id={`${id}-key`} type="password" value={key} onChange={(event) => { setKey(event.target.value); setError('') }} placeholder={profile?.hasKey ? (zh ? '此服务已有密钥，留空保留' : 'Key saved for this service; leave blank to keep') : (zh ? '粘贴此服务的 API 密钥' : 'Paste this service’s API key')} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={busy !== null} />
    <div className="ai-model-line"><span>{zh ? '模型' : 'Model'}</span><code>{model || (zh ? '请在高级设置填写' : 'Set in advanced settings')}</code></div>
    <details className="ai-advanced" open={provider === 'custom' ? true : undefined}>
      <summary>{zh ? '高级设置' : 'Advanced settings'}</summary>
      <label htmlFor={`${id}-model`}>{zh ? '模型名称' : 'Model name'}</label>
      <input id={`${id}-model`} value={model} onChange={(event) => { setModel(event.target.value); setError('') }} placeholder={AI_PRESETS[provider].model} spellCheck={false} autoComplete="off" disabled={busy !== null} />
      <label htmlFor={`${id}-url`}>{zh ? '接口地址' : 'API base URL'}</label>
      <input id={`${id}-url`} type="url" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setError('') }} placeholder="https://api.example.com/v1" spellCheck={false} autoComplete="off" disabled={busy !== null || provider !== 'custom'} />
      <p className="ai-hint">{zh ? '需要其他接口地址时请选择“自定义服务”。接口需兼容 OpenAI Chat Completions，地址不含 /chat/completions。' : 'Choose Custom service to use another API URL. It must support OpenAI Chat Completions; enter the base URL without /chat/completions.'}</p>
    </details>
    <div className="ai-actions">
      <button type="button" className="ai-button ai-button-primary" onClick={() => void save()} disabled={busy !== null || !draftChanged || (!key.trim() && !profile?.hasKey) || !model.trim() || !baseUrl.trim()}>
        {busy === 'save' && <LoaderCircle size={14} className="spin" />}{busy === 'save' ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存 AI 配置' : 'Save AI settings')}
      </button>
      <button type="button" className="ai-button" onClick={() => void test()} disabled={busy !== null || draftChanged || !profile?.hasKey}>
        {busy === 'test' && <LoaderCircle size={14} className="spin" />}{busy === 'test' ? (zh ? '正在测试…' : 'Testing…') : (zh ? '测试连接' : 'Test connection')}
      </button>
      {profile?.hasKey && <button type="button" className="ai-text-button" onClick={() => void clearKey()} disabled={busy !== null}>{zh ? '清除此服务密钥' : 'Remove this service’s key'}</button>}
    </div>
    <p className="ai-hint">{zh ? '保存只更新本机配置。点击“测试连接”才会发送一条很短的请求，可能产生少量费用。密钥不会回显。' : 'Saving only updates settings on this device. Test connection sends a short request and may incur a small charge. Your key is never displayed.'}</p>
    <p className={`ai-status ${!draftChanged && profile?.status === 'connected' ? 'ai-status-good' : ''}`} role="status">{busy === 'auth' ? (zh ? '请在浏览器完成授权，也可以取消或关闭设置。' : 'Complete authorization in your browser, or cancel or close settings.') : visibleError ? '' : status}</p>
    {visibleError && <p className="ai-error" role="alert">{visibleError}</p>}
    <button type="button" className="ai-text-button ai-help-toggle" onClick={() => setHelp((current) => !current)} aria-expanded={help} aria-controls={`${id}-help`}>{zh ? '没有密钥？查看获取方法' : 'Need a key? Learn how to get one'}</button>
    {help && <div className="ai-help" id={`${id}-help`}>
      <p>{zh ? '先在所选服务注册账号，再开通 API 并创建密钥。网页聊天的会员与 API 额度通常分开计算；调用前请确认账户有可用额度。' : 'Create an account with the selected service, enable API access, then create a key. Chat subscriptions and API credit are usually separate; check your available API credit before use.'}</p>
      <div className="ai-actions">
        {provider !== 'custom' && <button type="button" className="ai-text-button" onClick={() => openLink(AI_PRESETS[provider].helpUrl)}>{zh ? `前往 ${AI_PRESETS[provider].name} 获取密钥` : `Get a key from ${AI_PRESETS[provider].name}`}</button>}
        <button type="button" className="ai-text-button" onClick={() => openLink(`https://mdduck.com/${zh ? '' : 'en/'}guide/#ai-setup`)}>{zh ? '查看设置指南' : 'Read the setup guide'}</button>
      </div>
    </div>}
  </section>
}
