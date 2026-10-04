import { describe, expect, it } from 'vitest'
import { selectionPosition } from './selection-position'

describe('selection toolbar placement', () => {
  const size = { width: 210, height: 36 }
  const viewport = { width: 900, height: 600, top: 52 }

  it('keeps the toolbar near a short selection using its measured height', () => {
    expect(selectionPosition({ left: 120, right: 350, top: 420, bottom: 445 }, size, viewport))
      .toEqual({ left: 120, top: 455 })
  })

  it('uses space above a selection at the bottom of the viewport', () => {
    expect(selectionPosition({ left: 120, right: 350, top: 545, bottom: 570 }, size, viewport))
      .toEqual({ left: 120, top: 499 })
  })

  it('avoids the next line of text instead of covering it', () => {
    const anchor = { left: 120, right: 450, top: 250, bottom: 275 }
    const nextLine = { left: 120, right: 600, top: 290, bottom: 312 }
    expect(selectionPosition(anchor, size, viewport, [anchor, nextLine]))
      .toEqual({ left: 120, top: 204 })
  })

  it('clamps to the viewport and keeps the app header clear', () => {
    const result = selectionPosition({ left: 870, right: 895, top: 60, bottom: 84 }, size, viewport)
    expect(result.left + size.width).toBeLessThanOrEqual(888)
    expect(result.top).toBeGreaterThanOrEqual(52)
  })

  it('uses nearby space to the right of a heading before jumping far above a bottom selection', () => {
    const anchor = { left: 430.5, right: 1090.5, top: 624.8, bottom: 680.8 }
    const heading = { left: 430.5, right: 630, top: 567, bottom: 600 }
    const precedingText = { left: 430.5, right: 1090.5, top: 108, bottom: 563 }
    expect(selectionPosition(anchor, { width: 214, height: 38 }, { width: 1280, height: 720, top: 60 }, [
      precedingText, heading, heading, anchor
    ])).toEqual({ left: 876.5, top: 576.8 })
  })

  it('can use an obstacle edge in the nearby band when both anchor alignments are occupied', () => {
    const anchor = { left: 200, right: 700, top: 300, bottom: 325 }
    const obstacles = [
      { left: 190, right: 300, top: 240, bottom: 380 },
      { left: 610, right: 720, top: 240, bottom: 380 },
      anchor
    ]
    const result = selectionPosition(anchor, size, viewport, obstacles)
    expect(result.top).toBe(335)
    expect(result.left).toBeGreaterThanOrEqual(303)
    expect(result.left + size.width).toBeLessThanOrEqual(607)
  })

  it('keeps an offscreen anchor fallback below the app header', () => {
    expect(selectionPosition({ left: 120, right: 350, top: -70, bottom: -45 }, size, viewport))
      .toEqual({ left: 120, top: 52 })
  })
})
