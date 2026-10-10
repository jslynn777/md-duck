import type { PairingIssue, PairingLocation, PairingReport } from '../../shared/pairing-diagnostics'
import type { UiLang } from '../../shared/types'

export function pairingCoverage(report: PairingReport, ui: UiLang): string {
  return ui === 'zh'
    ? `结构对应：原文 ${report.pairedSource}/${report.totalSource} · 中文 ${report.pairedZh}/${report.totalZh}`
    : `Structural matches: source ${report.pairedSource}/${report.totalSource} · Chinese ${report.pairedZh}/${report.totalZh}`
}

export function pairingStatusCopy(report: PairingReport, ui: UiLang): { summary: string; detail: string } {
  const zh = ui === 'zh'
  const summary = report.status === 'missing-companion' ? zh ? '尚无可读的中文文件' : 'No readable Chinese companion' :
    report.status === 'unmarked' ? zh ? '尚未确认段落对应' : 'Paragraph correspondence is unverified' : pairingCoverage(report, ui)
  const reading = report.status === 'missing-companion' ? zh ? '继续阅读原文' : 'Continue reading the source' :
    report.independent ? zh ? '两栏独立阅读' : 'Two independent reading columns' :
      report.method === 'translation-sidecar' ? zh ? '按既有配对记录对照' : 'Reading with the existing pairing record' :
        zh ? '按既有标记对照' : 'Reading with the existing markers'
  const metadata = report.sidecar === 'stale' ? zh ? '旧配对记录已过期' : 'The old pairing record is stale' :
    report.sidecar === 'invalid' ? zh ? '配对记录无法使用' : 'The pairing record is unusable' : ''
  const warnings = report.issues.filter((issue) => issue.severity === 'warning').length
  const warningSummary = warnings ? zh ? `${warnings} 项需检查` : `${warnings} to inspect` : ''
  return { summary, detail: [reading, metadata, warningSummary].filter(Boolean).join(' · ') }
}

export function pairingIssueCopy(issue: PairingIssue, ui: UiLang): { title: string; detail: string } {
  const id = issue.markerId ? `：${issue.markerId}` : ''
  const enId = issue.markerId ? `: ${issue.markerId}` : ''
  const zh = ui === 'zh'
  switch (issue.kind) {
    case 'duplicate-marker': return { title: zh ? `标记重复${id}` : `Duplicate marker${enId}`,
      detail: zh ? '同一文件内的标记需要唯一。重复位置无法作为可靠的结构对应。' :
        'A marker must be unique within its file. Repeated occurrences cannot verify a structural match.' }
    case 'unassigned-marker': return { title: zh ? `标记未关联正文${id}` : `Marker has no content block${enId}`,
      detail: zh ? '该标记被后续标记覆盖、位于文件末尾，或放在当前解析器不支持的位置。行号指向源码中的标记，点击可定位附近正文。' :
        'This marker was superseded, is at the end of the file, or is placed where the current parser cannot attach it to content. The line identifies the source marker; clicking locates nearby readable content.' }
    case 'unmatched-marker': return { title: zh ? `另一份文件缺少同名标记${id}` : `No matching marker in the other file${enId}`,
      detail: zh ? '这一处没有可验证的对应段落。保留当前阅读方式，可自行核对另一份文件。' :
        'This location has no verified counterpart. The current reading behavior is preserved; check the other file if needed.' }
    case 'unmarked-block': return { title: zh ? '此段没有配对标记' : 'This block has no pairing marker',
      detail: zh ? '这是信息提示，仍可正常阅读；不代表译文缺失或有误。' :
        'This is informational. The block remains readable; it does not mean a translation is missing or incorrect.' }
    case 'marker-order': return { title: zh ? `标记顺序不同${id}` : `Marker order differs${enId}`,
      detail: zh ? '两份文件的标记顺序不一致。现有对照方式保留，请核对这些位置。' :
        'The markers appear in different orders. Existing reading alignment is preserved; inspect these locations.' }
    case 'block-shape': return { title: zh ? `对应块结构不同${id}` : `Block structures differ${enId}`,
      detail: zh ? '标题、段落、列表、表格等结构不一致，不能确认这一处的结构对应。' :
        'The heading, paragraph, list, table, or nested structure differs, so this structural match cannot be verified.' }
    case 'stale-sidecar': return { title: zh ? '配对记录已过期' : 'The pairing record is stale',
      detail: zh ? '原文或中文内容已改变，旧记录不再用于配对；当前已有的标记仍可使用。' :
        'Source or Chinese content has changed. The old record is no longer used; existing markers can still be used.' }
    case 'invalid-sidecar': return { title: zh ? '配对记录无法使用' : 'The pairing record is unusable',
      detail: zh ? '记录无法读取，或不符合当前文件与结构。继续使用当前标记，或独立阅读。' :
        'The record cannot be read or does not match the current files and structure. Existing markers or independent reading remain available.' }
  }
}

export function pairingLocationLine(issue: PairingIssue, location: PairingLocation): number {
  return ['duplicate-marker', 'unassigned-marker', 'unmatched-marker', 'marker-order'].includes(issue.kind)
    ? location.markerLine ?? location.line : location.line
}

export function pairingLocationLabel(issue: PairingIssue, location: PairingLocation, ui: UiLang): string {
  const line = pairingLocationLine(issue, location)
  return ui === 'zh' ? `${location.side === 'source' ? '原文' : '中文'} · 第 ${line} 行` :
    `${location.side === 'source' ? 'Source' : 'Chinese'} · line ${line}`
}

export function pairingEmptyCopy(report: PairingReport, ui: UiLang): string {
  const zh = ui === 'zh'
  if (report.status === 'missing-companion') return zh ? '没有可读的中文文件，暂时无法检查两份文件的段落对应。' :
    'There is no readable Chinese file, so correspondence between the two files cannot be checked yet.'
  if (report.status === 'unmarked') return zh ? '没有可验证的配对标记或记录。两栏保持独立阅读；相同段落数量不能证明对应。' :
    'There are no verifiable pairing markers or records. Both columns remain independent; equal block counts do not prove correspondence.'
  return zh ? '整篇结构检查未发现问题。' : 'The whole-document structure check found no issues.'
}

export function pairingFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
