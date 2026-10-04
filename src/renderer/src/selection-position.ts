export type SelectionRect = { left: number; right: number; top: number; bottom: number }

/** Prefer nearby whitespace; never move the document to make room for a toolbar. */
export function selectionPosition(
  anchor: SelectionRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number; top?: number },
  occupied: SelectionRect[] = []
) {
  const margin = 12
  const gap = 10
  const minTop = Math.max(margin, viewport.top ?? 0)
  const maxTop = Math.max(minTop, viewport.height - size.height - margin)
  const maxLeft = Math.max(margin, viewport.width - size.width - margin)
  const clampLeft = (left: number) => Math.max(margin, Math.min(left, maxLeft))
  const left = clampLeft(anchor.left)
  const clamp = (top: number) => Math.max(minTop, Math.min(top, maxTop))
  const below = anchor.bottom + gap
  const above = anchor.top - size.height - gap
  const rectangles = [...new Map(occupied.map((rect) => [
    `${rect.left},${rect.right},${rect.top},${rect.bottom}`, rect
  ])).values()]
  const overlaps = (top: number, rect: SelectionRect, spacing = 0) =>
    top < rect.bottom + spacing && top + size.height > rect.top - spacing
  const clearAt = (x: number, top: number) => !rectangles.some((rect) =>
    rect.right + 3 > x && rect.left - 3 < x + size.width && overlaps(top, rect, 3))
  const nearTops = [below, above].filter((top) => top >= minTop && top <= maxTop)
  const nearLefts = [...new Set([left, clampLeft(anchor.right - size.width)])]

  // Check both ends of the selection before seeking a distant vertical gap.
  for (const top of nearTops) {
    for (const x of nearLefts) {
      if (clearAt(x, top)) return { left: x, top }
    }
  }
  // Only adjust horizontally beside obstacles in these two nearby bands.
  for (const top of nearTops) {
    const edges = [...new Set(rectangles.filter((rect) => overlaps(top, rect, 3))
      .flatMap((rect) => [clampLeft(rect.right + 4), clampLeft(rect.left - size.width - 4)]))]
      .filter((x) => x < anchor.right && x + size.width > anchor.left)
      .sort((a, b) => Math.min(...nearLefts.map((x) => Math.abs(a - x))) - Math.min(...nearLefts.map((x) => Math.abs(b - x))))
    const x = edges.find((candidate) => clearAt(candidate, top))
    if (x !== undefined) return { left: x, top }
  }

  const obstacles = rectangles.filter((rect) => rect.right > left && rect.left < left + size.width)
  const candidates = [below, above, ...obstacles.flatMap((rect) => [rect.bottom + 4, rect.top - size.height - 4])]
    .filter((top) => top >= minTop && top <= maxTop && !overlaps(top, anchor, gap))
    .sort((a, b) => Math.min(Math.abs(a - below), Math.abs(a - above)) - Math.min(Math.abs(b - below), Math.abs(b - above)))
  const clear = candidates.find((top) => !obstacles.some((rect) => overlaps(top, rect, 3)))
  // A long selection may leave no empty band. Keep the real selection clear first.
  const fallback = below >= minTop && below <= maxTop ? below : above >= minTop && above <= maxTop ? above : clamp(below)
  return { left, top: clear ?? fallback }
}
