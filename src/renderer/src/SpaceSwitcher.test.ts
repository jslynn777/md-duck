import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SpaceSummary } from '../../shared/spaces'
import { SpaceCover, SpaceSwitcher, spaceAvailabilityCopy, spaceCoverImages } from './SpaceSwitcher'

const local = (path: string) => `md-duck://asset/?path=${encodeURIComponent(path)}&scope=space-a`
const space: SpaceSummary = { id: 'a', name: 'Article series', root: '/articles', openPath: '/articles/one.md', createdAt: '', lastOpenedAt: '', availability: 'ready', windowOpen: false }

describe('space switcher', () => {
  it('allows only scoped local cover images, deduplicates and bounds the mosaic', () => {
    const allowed = [1, 2, 3, 4, 5].map(index => local(`/articles/${index}.png`))
    expect(spaceCoverImages(['https://example.com/image.png', 'file:///articles/a.png', 'data:image/png;base64,AA', 'md-duck://asset/?path=/articles/a.png', local('/articles/1.png'), ...allowed])).toEqual(allowed.slice(0, 4))
  })
  it('uses a paper cover without triggering a remote image request', () => {
    const html = renderToStaticMarkup(createElement(SpaceCover, { space: { previewImages: ['https://example.com/private.png'] } }))
    expect(html).toContain('space-cover-paper')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('example.com')
  })
  it('shows the actual current space and provides a direct menu entry', () => {
    const html = renderToStaticMarkup(createElement(SpaceSwitcher, { ui: 'en', spaces: [space], activeSpaceId: space.id, onSwitch: vi.fn(), onAdd: vi.fn(), onManage: vi.fn() }))
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-label="Switch space: Article series"')
    expect(html).toContain('Article series')
    expect(html).not.toContain('spaces-overview')
  })
  it('keeps settings failures distinct from missing local folders', () => {
    expect(spaceAvailabilityCopy({ ...space, availability: 'unreadable', unavailableReason: 'settings' }, 'zh')).toBe('空间设置暂时无法读取')
    expect(spaceAvailabilityCopy({ ...space, availability: 'missing' }, 'en')).toBe('Folder moved or disconnected')
    expect(spaceAvailabilityCopy(space, 'en')).toBe('')
  })
})
