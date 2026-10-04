import { useEffect, useId, useRef, useState } from 'react'
import { AArrowDown, AArrowUp, Type } from 'lucide-react'
import { useT } from './i18n'

export function ReadingOptions({ fontSize, onChange }: { fontSize: number; onChange: (size: number) => void }) {
  const tr = useT()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        setOpen(false)
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div className="reading-options" ref={root} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <button
        ref={trigger}
        className={`btn icon ghost${open ? ' active' : ''}`}
        title={tr('readingAppearance')}
        aria-label={tr('readingAppearance')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Type size={17} />
      </button>
      {open && (
        <div className="reading-options-popover" id={id} ref={panel} role="dialog" aria-labelledby={`${id}-title`} tabIndex={-1}>
          <div className="reading-options-heading" id={`${id}-title`}>{tr('readingAppearance')}</div>
          <div className="type-sample" aria-hidden="true">
            <span style={{ fontSize }}>Aa</span>
            <span lang="zh" style={{ fontSize: Math.max(15, fontSize - 1) }}>文</span>
          </div>
          <div className="type-controls">
            <span>{tr('textSize')}</span>
            <div className="type-stepper">
              <button className="btn icon ghost" disabled={fontSize <= 15} onClick={() => onChange(Math.max(15, fontSize - 1))} title={tr('smaller')} aria-label={tr('smaller')}>
                <AArrowDown size={17} />
              </button>
              <output aria-live="polite">{fontSize}</output>
              <button className="btn icon ghost" disabled={fontSize >= 26} onClick={() => onChange(Math.min(26, fontSize + 1))} title={tr('larger')} aria-label={tr('larger')}>
                <AArrowUp size={17} />
              </button>
            </div>
          </div>
          <button className="btn small ghost type-reset" disabled={fontSize === 18} onClick={() => onChange(18)}>{tr('resetTextSize')}</button>
        </div>
      )}
    </div>
  )
}
