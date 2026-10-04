import { useEffect, useRef, useState } from 'react'
import { Copy, X } from 'lucide-react'
import type { AppState, Preferences } from '@shared/types'
import type { AISettings } from '@shared/ai'
import { VOICES } from '@shared/types'
import { voiceLabel } from '@shared/i18n'
import { AISettings as AISettingsPanel } from './AISettings'
import { useT, useUi } from './i18n'

export function SettingsModal({ state, onPrefs, aiSettings, onAISettings, onClose, onCopyConvention }: {
  state: AppState
  onPrefs: (patch: Partial<Preferences>) => void
  aiSettings: AISettings | null
  onAISettings: (next: AISettings) => void
  onClose: () => void
  onCopyConvention: () => void
}) {
  const tr = useT()
  const ui = useUi()
  const zh = ui === 'zh'
  const ref = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLDivElement>(null)
  const editingControl = useRef<HTMLElement | null>(null)
  const [aiDraft, setAIDraft] = useState({ dirty: false, busy: false })
  const [confirmClose, setConfirmClose] = useState(false)
  useEffect(() => {
    if (!confirmClose) return
    if (!aiDraft.dirty && !aiDraft.busy) { setConfirmClose(false); return }
    confirmRef.current?.scrollIntoView({ block: 'nearest' })
    confirmRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [confirmClose, aiDraft.dirty, aiDraft.busy])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const veil = ref.current?.parentElement
    const siblings = [...(veil?.parentElement?.children ?? [])]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== veil)
    const previousInert = siblings.map((element) => element.inert)
    siblings.forEach((element) => { element.inert = true })
    ref.current?.querySelector<HTMLElement>('button, select, input')?.focus()
    return () => {
      siblings.forEach((element, index) => { element.inert = previousInert[index] })
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  function requestClose() {
    if (!confirmClose && ref.current?.contains(document.activeElement)) editingControl.current = document.activeElement as HTMLElement
    if (aiDraft.busy || aiDraft.dirty) setConfirmClose(true)
    else onClose()
  }

  return (
    <div className="modal-veil" onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose()
    }}>
      <div ref={ref} className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); requestClose() }
        if (event.key !== 'Tab') return
        const controls = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], textarea:not(:disabled)') ?? [])]
          .filter((element) => element.getClientRects().length > 0)
        const first = controls[0], last = controls[controls.length - 1]
        if (!first) { event.preventDefault(); return }
        if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) {
          event.preventDefault(); first.focus()
        }
      }}>
        <div className="settings-heading">
          <h2 id="settings-title">{tr('settings')}</h2>
          <button className="btn icon ghost" onClick={requestClose} aria-label={tr('close')}><X size={17} /></button>
        </div>
        <section className="settings-section" aria-labelledby="reading-settings-title">
          <div className="settings-section-heading">
            <h3 id="reading-settings-title">{zh ? '阅读与声音' : 'Reading and audio'}</h3>
            <span>{zh ? '修改立即生效' : 'Changes apply immediately'}</span>
          </div>
          <div className="field">
            <span id="ui-language-label">{tr('language')}</span>
            <div className="seg" role="group" aria-labelledby="ui-language-label">
              <button aria-pressed={ui === 'en'} className={ui === 'en' ? 'on' : ''} onClick={() => onPrefs({ ui: 'en' })}>English</button>
              <button aria-pressed={ui === 'zh'} className={ui === 'zh' ? 'on' : ''} onClick={() => onPrefs({ ui: 'zh' })}>中文</button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="reading-voice">{tr('voice')}</label>
            <select id="reading-voice" value={state.prefs.voice} onChange={(event) => onPrefs({ voice: event.target.value as Preferences['voice'] })}>
              {VOICES.map((id) => <option key={id} value={id}>{voiceLabel(ui, id)}</option>)}
            </select>
            <p className="desc">{zh ? '首次朗读会下载约 92 MB 的声音模型，之后可在本机使用。' : 'The first playback downloads a voice model of about 92 MB for later local use.'}</p>
          </div>
          <div className="field">
            <label htmlFor="reading-speed">{tr('speed')}</label>
            <div className="range-row">
              <input id="reading-speed" type="range" min={0.7} max={1.3} step={0.05} value={state.prefs.speed}
                aria-valuetext={`${state.prefs.speed.toFixed(2)}×`}
                onChange={(event) => onPrefs({ speed: Number(event.target.value) })} />
              <span className="val">{state.prefs.speed.toFixed(2)}×</span>
            </div>
          </div>
        </section>
        <section className="settings-section">
          <AISettingsPanel value={aiSettings} onChange={onAISettings} ui={ui} onDraftStateChange={setAIDraft} />
        </section>
        <details className="settings-convention">
          <summary>{tr('convention')}</summary>
          <p className="desc">{tr('conventionDesc')}</p>
          <button className="btn ghost" onClick={onCopyConvention}><Copy size={15} />{tr('copyConvention')}</button>
        </details>
        {confirmClose && (
          <div ref={confirmRef} className="settings-close-confirm" role="alert">
            <p>{aiDraft.busy
              ? (zh ? '正在处理 AI 配置，请完成后再关闭。' : 'AI settings are being processed. Wait before closing.')
              : (zh ? 'AI 配置还未保存。关闭会放弃这些修改。' : 'AI settings are not saved. Closing will discard these changes.')}</p>
            <div className="actions">
              <button className="btn small ghost" onClick={() => {
                setConfirmClose(false)
                requestAnimationFrame(() => {
                  const control = editingControl.current?.isConnected ? editingControl.current
                    : ref.current?.querySelector<HTMLElement>('.ai-settings input, .ai-settings select')
                  control?.focus()
                })
              }}>{zh ? '返回编辑' : 'Keep editing'}</button>
              {!aiDraft.busy && <button className="btn small ghost" onClick={onClose}>{zh ? '放弃修改并关闭' : 'Discard changes and close'}</button>}
            </div>
          </div>
        )}
        <div className="foot"><button className="btn primary" onClick={requestClose}>{tr('close')}</button></div>
      </div>
    </div>
  )
}
