import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PairingCheckDialog, PairingStatus } from './PairingCheck'
import { pairingCoverage, pairingEmptyCopy, pairingFileName, pairingIssueCopy, pairingLocationLabel, pairingStatusCopy } from './pairing-copy'
import type { PairingIssue, PairingIssueKind, PairingLocation, PairingReport } from '../../shared/pairing-diagnostics'

const complete: PairingReport = { status: 'complete', method: 'markers', totalSource: 3, totalZh: 3,
  pairedSource: 3, pairedZh: 3, independent: false, sidecar: 'absent', issues: [] }
const location: PairingLocation = { side: 'source', blockKey: 'id:a', line: 12, endLine: 14, markerLine: 10 }
function issue(kind: PairingIssueKind): PairingIssue {
  return { id: kind, kind, severity: kind === 'unmarked-block' ? 'info' : 'warning', markerId: 'a', source: location }
}
const kinds: PairingIssueKind[] = ['duplicate-marker', 'unassigned-marker', 'unmatched-marker', 'unmarked-block',
  'marker-order', 'block-shape', 'stale-sidecar', 'invalid-sidecar']

describe('accurate pairing wording', () => {
  it('labels verified structural coverage separately from current reading alignment', () => {
    const report: PairingReport = { ...complete, status: 'partial', pairedSource: 1, pairedZh: 1, totalZh: 4 }
    expect(pairingCoverage(report, 'zh')).toBe('结构对应：原文 1/3 · 中文 1/4')
    expect(pairingCoverage(report, 'en')).toBe('Structural matches: source 1/3 · Chinese 1/4')
    expect(pairingStatusCopy(report, 'zh').detail).toBe('按既有标记对照')
    expect(pairingStatusCopy(report, 'en').detail).toBe('Reading with the existing markers')
  })

  it('does not confuse an expired record with missing manual ID pairing', () => {
    const report: PairingReport = { ...complete, sidecar: 'stale', issues: [issue('stale-sidecar')] }
    for (const ui of ['zh', 'en'] as const) {
      const copy = pairingStatusCopy(report, ui)
      expect(copy.summary).toContain('3/3')
      expect(copy.detail).toContain(ui === 'zh' ? '既有标记' : 'existing markers')
      expect(copy.detail).toContain(ui === 'zh' ? '已过期' : 'stale')
      expect(copy.detail).not.toContain(ui === 'zh' ? '独立阅读' : 'independent')
    }
  })

  it('flags warning locations even when all content blocks have structural matches', () => {
    const report: PairingReport = { ...complete, status: 'partial', issues: [issue('unassigned-marker'), issue('duplicate-marker'), issue('unmarked-block')] }
    expect(pairingStatusCopy(report, 'zh')).toEqual({ summary: '结构对应：原文 3/3 · 中文 3/3', detail: '按既有标记对照 · 2 项需检查' })
    expect(pairingStatusCopy(report, 'en').detail).toBe('Reading with the existing markers · 2 to inspect')
  })

  it('keeps missing companions and unverified independent documents distinct', () => {
    const missing: PairingReport = { ...complete, status: 'missing-companion', method: 'none', independent: true,
      pairedSource: 0, pairedZh: 0, totalZh: 0 }
    const unmarked: PairingReport = { ...missing, status: 'unmarked', totalZh: 3 }
    expect(pairingStatusCopy(missing, 'zh')).toEqual({ summary: '尚无可读的中文文件', detail: '继续阅读原文' })
    expect(pairingStatusCopy(unmarked, 'zh')).toEqual({ summary: '尚未确认段落对应', detail: '两栏独立阅读' })
    expect(pairingEmptyCopy(unmarked, 'en')).toContain('equal block counts do not prove correspondence')
    expect(pairingEmptyCopy(missing, 'en')).toContain('no readable Chinese file')
  })

  it('describes unusable records without asserting corruption or changing reading behavior', () => {
    const report: PairingReport = { ...complete, method: 'none', status: 'unmarked', independent: true,
      pairedSource: 0, pairedZh: 0, sidecar: 'invalid' }
    expect(pairingStatusCopy(report, 'zh').detail).toBe('两栏独立阅读 · 配对记录无法使用')
    for (const ui of ['zh', 'en'] as const) {
      const copy = pairingIssueCopy(issue('invalid-sidecar'), ui)
      expect(copy.title).not.toMatch(/损坏|corrupt/i)
      expect(copy.detail).toContain(ui === 'zh' ? '无法读取' : 'cannot be read')
    }
  })

  it('provides distinct concrete explanations for every issue kind in both languages', () => {
    for (const ui of ['zh', 'en'] as const) {
      const copies = kinds.map((kind) => pairingIssueCopy(issue(kind), ui))
      expect(new Set(copies.map((copy) => copy.title)).size).toBe(kinds.length)
      expect(copies.every((copy) => copy.title.length > 0 && copy.detail.length > 20)).toBe(true)
    }
    expect(pairingIssueCopy(issue('unmarked-block'), 'zh').detail).toContain('信息提示')
    expect(pairingIssueCopy(issue('unmarked-block'), 'zh').detail).toContain('不代表译文缺失或有误')
    expect(pairingIssueCopy(issue('unmarked-block'), 'en').detail).toContain('informational')
    expect(pairingIssueCopy(issue('unassigned-marker'), 'zh').detail).toContain('点击可定位附近正文')
    expect(pairingIssueCopy(issue('unassigned-marker'), 'en').detail).toContain('nearby readable content')
  })

  it('uses marker lines for annotation faults and content lines for structural faults', () => {
    expect(pairingLocationLabel(issue('duplicate-marker'), location, 'zh')).toBe('原文 · 第 10 行')
    expect(pairingLocationLabel(issue('marker-order'), { ...location, side: 'zh' }, 'en')).toBe('Chinese · line 10')
    expect(pairingLocationLabel(issue('block-shape'), location, 'zh')).toBe('原文 · 第 12 行')
    expect(pairingLocationLabel(issue('unmarked-block'), { ...location, markerLine: undefined }, 'en')).toBe('Source · line 12')
  })

  it('displays understandable filenames for both platforms while retaining original paths for the UI', () => {
    expect(pairingFileName('/Users/me/资料/article.md')).toBe('article.md')
    expect(pairingFileName('C:\\资料\\中文译文.md')).toBe('中文译文.md')
    expect(pairingFileName('\\\\server\\share\\article.md')).toBe('article.md')
  })
})

describe('pairing check presentation', () => {
  const renderDialog = (report: PairingReport, ui: 'zh' | 'en' = 'zh') => renderToStaticMarkup(createElement(PairingCheckDialog, {
    report, ui, sourcePath: '/资料/source.md', zhPath: 'C:\\资料\\中文.md', onClose: () => undefined, onLocate: () => undefined
  }))

  it('uses an accessible native dialog and shows counts and scope even with no issues', () => {
    const html = renderDialog(complete)
    expect(html).toMatch(/^<dialog[^>]*aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"/)
    expect(html).toContain('aria-label="关闭配对检查"')
    expect(html).toContain('结构对应：原文 3/3 · 中文 3/3')
    expect(html).toContain('整篇结构检查未发现问题')
    expect(html).toContain('不判断翻译是否准确')
    expect(html).toContain('检查不会更改文件或阅读方式')
    expect(html).toContain('title="/资料/source.md"')
    expect(html).toContain('中文.md')
  })

  it('retains every whole-document issue and exposes only usable location buttons', () => {
    const problems = Array.from({ length: 35 }, (_, index) => ({ ...issue('unmarked-block'), id: `info:${index}`,
      source: { ...location, blockKey: index === 34 ? null : `auto:${index}`, line: index + 1, markerLine: undefined } }))
    const html = renderDialog({ ...complete, status: 'partial', pairedSource: 1, pairedZh: 1, issues: problems })
    expect(html.match(/class="pairing-issue pairing-issue-info"/g)).toHaveLength(35)
    expect(html.match(/class="pairing-location"/g)).toHaveLength(34)
    expect(html).toContain('<span class="pairing-location-static">原文 · 第 35 行</span>')
    expect(html).toContain('0 项需检查 · 35 项信息提示')
    expect(html).not.toContain('35 项错误')
  })

  it('explains unmarked documents rather than claiming a successful automatic pairing', () => {
    const report: PairingReport = { ...complete, status: 'unmarked', method: 'none', independent: true,
      pairedSource: 0, pairedZh: 0 }
    const html = renderDialog(report, 'en')
    expect(html).toContain('source 0/3 · Chinese 0/3')
    expect(html).toContain('Both columns remain independent')
    expect(html).not.toContain('found no issues')
  })

  it('keeps the in-reader status compact and makes the full check an explicit action', () => {
    const html = renderToStaticMarkup(createElement(PairingStatus, { report: complete, ui: 'zh', onCheck: () => undefined }))
    expect(html).toContain('role="status"')
    expect(html).toContain('结构对应：原文 3/3 · 中文 3/3')
    expect(html).toContain('按既有标记对照')
    expect(html).toContain('>检查整篇</button>')
    expect(html).not.toContain('整篇结构检查未发现问题')
  })
})
