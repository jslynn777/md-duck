import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CodexTaskSnapshot } from '../../shared/codex-task'
import type { SpaceSummary } from '../../shared/spaces'
import { CodexTaskPanel, codexActivityCopy, codexErrorCopy, codexPhaseLabel } from './CodexTaskPanel'
import { codexRootsMatch } from './useCodexTasks'

const space: SpaceSummary = { id: 'a', name: 'Article series', root: '/articles', openPath: '/articles/one.md', createdAt: '', lastOpenedAt: '', availability: 'ready', windowOpen: false }
const snapshot: CodexTaskSnapshot = { spaceId: 'a', root: '/articles', availability: { state: 'ready' }, task: null, approvals: [] }
function render(state = snapshot) {
  const onStart = vi.fn()
  const html = renderToStaticMarkup(createElement(CodexTaskPanel, { open: true, ui: 'en', space, relativePath: 'one.md', snapshot: state, loading: false, busy: false, error: '', onStart, onStop: vi.fn(), onRespond: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(), onReview: vi.fn(), onContext: vi.fn() }))
  return { html, onStart }
}

describe('Codex space task panel', () => {
  it('waits for an explicit task instead of starting work when the panel opens', () => {
    const { html, onStart } = render()
    expect(html).toContain('Start local task')
    expect(html).toContain('/articles')
    expect(html).toContain('one.md')
    expect(html).toContain('type="submit"')
    expect(onStart).not.toHaveBeenCalled()
  })
  it('distinguishes needing approval, completion and an interrupted connection', () => {
    expect(codexPhaseLabel('waiting-approval', 'zh')).toBe('需要你的批准')
    expect(codexPhaseLabel('review', 'en')).toBe('Ready for your review')
    expect(codexPhaseLabel('disconnected', 'en')).toBe('Disconnected; status unknown')
    expect(codexPhaseLabel('stopped', 'zh')).toBe('已停止')
  })
  it('escapes task output and offers approval only for the actual pending request', () => {
    const { html } = render({ ...snapshot, task: { id: 't', root: '/articles', phase: 'waiting-approval', prompt: 'Improve one.md', activity: '', messages: [{ id: 'm', kind: 'assistant', text: '<script>run()</script>', at: '' }], changedFiles: [], startedAt: '', updatedAt: '' }, approvals: [{ id: 'approval', kind: 'command', command: 'echo "<script>"', cwd: '/articles' }] })
    expect(html).toContain('Approve once')
    expect(html).toContain('Decline')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Stop task')
  })
  it('keeps missing login distinct from a running or completed task', () => {
    const { html } = render({ ...snapshot, availability: { state: 'not-logged-in' } })
    expect(html).toContain('Sign in to Codex')
    expect(html).not.toContain('Ready for your review')
    expect(html).not.toContain('Stop task')
  })
  it('does not show an old root snapshot after the same space has moved', () => {
    const { html } = render({ ...snapshot, root: '/previous-folder', task: { id: 'old', root: '/previous-folder', phase: 'running', prompt: 'Old-folder task', activity: '', messages: [], changedFiles: [], startedAt: '', updatedAt: '' } })
    expect(html).not.toContain('Old-folder task')
    expect(html).not.toContain('Stop task')
  })
  it('allows explicit continuation after the host has rechecked a historical disconnect', () => {
    const { html } = render({ ...snapshot, task: { id: 'old', root: '/articles', phase: 'disconnected', prompt: 'Previous task', activity: 'disconnected', messages: [], changedFiles: [], startedAt: '', updatedAt: '' } })
    expect(html).toContain('Disconnected; status unknown')
    expect(html).toContain('What next?')
    expect(html).not.toContain('Local Codex is not available yet')
    expect(html).not.toContain('The task has stopped')
  })
  it('describes observed file updates without claiming Codex wrote every file', () => {
    const { html } = render({ ...snapshot, task: { id: 't', root: '/articles', phase: 'review', prompt: 'Update this article', activity: 'checking-changes', messages: [], changedFiles: ['one.md'], startedAt: '', updatedAt: '' } })
    expect(html).toContain('Files updated during this task')
    expect(html).toContain('Files saved by other editors during this time may also be included.')
    expect(html).toContain('one.md')
    expect(codexActivityCopy('checking-changes', 'zh')).toBe('正在核对保存结果')
  })
  it('handles Windows root spelling and gives sandbox setup a specific explanation', () => {
    expect(codexRootsMatch('C:\\Articles', 'c:/articles/')).toBe(true)
    expect(codexRootsMatch('/Articles', '/articles')).toBe(false)
    expect(codexRootsMatch('/articles', '/moved-articles')).toBe(false)
    expect(codexErrorCopy('ERR_CODEX_WINDOWS_SANDBOX', 'zh')).toBe('请先在 Codex 完成 Windows 沙箱设置。')
    expect(codexErrorCopy('ERR_CODEX_STOP_UNCONFIRMED', 'zh')).toContain('尚未确认')
  })
})
