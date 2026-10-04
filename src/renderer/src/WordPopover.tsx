import { useLayoutEffect, useRef, useState } from 'react'
import { WordCard, type WordCardProps } from './WordCard'
import { useT } from './i18n'

export function WordPopover({ x, y, autoFocus = false, ...props }: WordCardProps & { x: number; y: number; autoFocus?: boolean }) {
  const tr = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 12, top: 12 })
  const closeRef = useRef(props.onClose)
  closeRef.current = props.onClose

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const previous = document.activeElement as HTMLElement | null
    if (autoFocus) element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const place = () => {
      const { width, height } = element.getBoundingClientRect()
      const left = Math.max(12, Math.min(x - width / 2, window.innerWidth - width - 12))
      const preferredTop = y + height <= window.innerHeight - 12 ? y : y - 32 - height
      const top = Math.max(12, Math.min(preferredTop, window.innerHeight - height - 12))
      setPosition((current) => current.left === left && current.top === top ? current : { left, top })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(element)
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) closeRef.current()
    }
    const scroll = (event: Event) => {
      if (!element.contains(event.target as Node)) closeRef.current()
    }
    const resize = () => closeRef.current()
    document.addEventListener('pointerdown', outside)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      const focusWasInside = element.contains(document.activeElement)
      observer.disconnect()
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
      if (autoFocus && focusWasInside && previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [x, y, autoFocus])

  return (
    <div ref={ref} className="pop word-pop" style={position} role="dialog" aria-label={tr('words')} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); props.onClose() }
    }}>
      <WordCard {...props} />
    </div>
  )
}
