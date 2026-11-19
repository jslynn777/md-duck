import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SpaceSummary } from '../../shared/spaces'
import { SpaceOverview, spaceError } from './Spaces'

function space(patch: Partial<SpaceSummary> = {}): SpaceSummary {
  return { id: 'space-a', name: 'Articles', root: '/local/articles', createdAt: '2026-11-17T00:00:00Z', lastOpenedAt: '2026-11-17T00:00:00Z', openPath: '/local/articles/first.md', lastTitle: 'First article', availability: 'ready', windowOpen: false, ...patch }
}
function render(spaces: SpaceSummary[]) {
  return renderToStaticMarkup(createElement(SpaceOverview, { ui: 'en', spaces, activeSpaceId: 'space-a', onOpen: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn(), onRelocate: vi.fn(), onContext: vi.fn(), onClose: vi.fn() }))
}

describe('space overview states', () => {
  it('shows only verified change counts and keeps each folder identifiable', () => {
    const html = render([space({ changedCount: 3 }), space({ id: 'space-b', name: 'Journal', root: '/local/journal', changedCount: undefined, windowOpen: true })])
    expect(html).toContain('3 updated')
    expect(html).not.toContain('0 updated')
    expect(html).toContain('/local/articles')
    expect(html).toContain('/local/journal')
    expect(html).toContain('Open window')
    expect(html).toContain('aria-label="Open space: Journal"')
  })
  it('keeps a missing space visible with a relocation action instead of presenting an empty library', () => {
    const html = render([space({ availability: 'missing' })])
    expect(html).toContain('Folder moved or disconnected')
    expect(html).toContain('Locate folder')
    expect(html).toContain('space-card-open" disabled=""')
    expect(html).not.toContain('3 updated')
  })
  it('renders local article excerpts as text without turning them into markup', () => {
    const html = render([space({ lastTitle: '<script>alert(1)</script>', previewText: '<img src=x onerror=alert(1)>' })])
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img ')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img')
  })
  it('distinguishes unreadable settings from a missing folder', () => {
    const html = render([space({ availability: 'unreadable', unavailableReason: 'settings' })])
    expect(html).toContain('Space settings cannot be read')
    expect(html).toContain('Other spaces remain available')
    expect(html).not.toContain('Folder moved or disconnected')
    expect(html).not.toContain('Locate folder')
  })
  it('distinguishes an occupied window, overlapping root and unsaved draft from a generic error', () => {
    expect(spaceError(new Error('ERR_SPACE_WINDOW_OPEN'), 'en')).toContain('another window')
    expect(spaceError(new Error('ERR_SPACE_ROOT_OVERLAP'), 'en')).toContain('overlaps')
    expect(spaceError(new Error('SPACE_DRAFT_UNSAVED'), 'zh')).toContain('草稿')
  })
})
