import { useLayoutEffect, useRef, useState } from 'react'

export function reducedSpaceMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Keep an exiting surface mounted so its animation can finish before removal. */
export function useSpacePresence(open: boolean, exitMs: number, beforeExit?: () => void): boolean {
  const [present, setPresent] = useState(open)
  const exitRef = useRef(beforeExit)
  exitRef.current = beforeExit
  useLayoutEffect(() => {
    if (open) { setPresent(true); return }
    if (!present) return
    const finish = () => { exitRef.current?.(); setPresent(false) }
    if (reducedSpaceMotion()) { finish(); return }
    const timer = window.setTimeout(finish, exitMs)
    return () => window.clearTimeout(timer)
  }, [open, present, exitMs])
  return open || present
}
