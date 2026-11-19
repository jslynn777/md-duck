import { francAll } from 'franc'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { Nodes } from 'mdast'

const parser = unified().use(remarkParse)
const names = {
  en: new Intl.DisplayNames('en', { type: 'language', fallback: 'none' }),
  zh: new Intl.DisplayNames('zh', { type: 'language', fallback: 'none' }),
}
const writtenNames: Record<string, string> = {
  english: 'en', french: 'fr', français: 'fr', german: 'de', deutsch: 'de',
  spanish: 'es', español: 'es', chinese: 'zh', 中文: 'zh', 简体中文: 'zh-Hans',
  繁體中文: 'zh-Hant', 英文: 'en', 英语: 'en', 法语: 'fr', 日本語: 'ja', 한국어: 'ko',
}

function canonicalTag(input: string): string | undefined {
  try {
    const locale = new Intl.Locale(input.replaceAll('_', '-'))
    if (['und', 'mul', 'zxx', 'mis'].includes(locale.language) || !names.en.of(locale.language)) return
    return locale.baseName
  } catch {
    return undefined
  }
}

export function documentLanguageLabel(tag: string | undefined, ui: 'en' | 'zh', fallback: string): string {
  const valid = tag && canonicalTag(tag)
  if (!valid) return fallback
  const base = new Intl.Locale(valid).language
  if (ui === 'zh' && base === 'en') return '英文'
  return names[ui].of(base) ?? fallback
}

function visibleText(node: Nodes): string {
  if (node.type === 'text') return node.value
  return 'children' in node ? node.children.map(visibleText).join('') : ''
}

function proseSamples(body: string): string[] {
  const paragraphs: string[] = []
  function visit(node: Nodes) {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const text = visibleText(node)
        .replace(/(?:https?:\/\/|www\.|mailto:)\S+|\S+@\S+\.\S+/gi, ' ')
        .replace(/(?:^|\s)(?:[a-z]:[\\/]|\.{0,2}\/|~\/|[^\s/\\]+[\\/])[^\s]+/gi, ' ')
        .replace(/\b[\w.-]+\.(?:md|html?|js|ts|json|png|jpe?g|svg|webp|pdf)\b/gi, ' ')
        .replace(/\s+/g, ' ').trim()
      // Vote on passages separately so a translated paragraph does not drown out
      // the surrounding prose. Bound individual classifier calls on large blocks.
      for (const passage of text.match(/.{1,360}(?:\s|$)|.{1,360}/gu) ?? []) paragraphs.push(passage)
    } else if ('children' in node) node.children.forEach(visit)
  }
  visit(parser.parse(body.slice(0, 32_000)))
  if (paragraphs.length <= 12) return paragraphs
  return Array.from({ length: 12 }, (_, i) => paragraphs[Math.round(i * (paragraphs.length - 1) / 11)])
}

function classify(text: string, letters: number): string | undefined {
  // Kana and Hangul distinguish Japanese and Korean even when a passage contains
  // more shared Han characters than syllabic characters.
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0
  const kana = text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0
  const hangul = text.match(/\p{Script=Hangul}/gu)?.length ?? 0
  if (kana >= 3 && (han + kana) / letters >= 0.65) return 'ja'
  if (hangul >= 5 && (han + hangul) / letters >= 0.65) return 'ko'
  if (han >= 8 && han / letters >= 0.65) return 'zh'

  if (letters < 40) return
  const words = text.toLowerCase().match(/\p{L}[\p{L}\p{M}]*/gu) ?? []
  if (new Set(words).size < 5 && !/[\p{Script=Thai}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Lao}]/u.test(text)) return
  const [best, second] = francAll(text)
  if (!best || best[0] === 'und') return
  // Ordinary English is often ranked just behind Scots on short paragraphs.
  // Resolve that narrow ambiguity only when several English forms agree.
  if ((best[0] === 'sco' || best[0] === 'eng') && (second?.[0] === 'eng' || second?.[0] === 'sco')) {
    const english = new Set(words.filter(word => /^(the|this|that|what|which|with|from|when|would|your|before|without)$/.test(word)))
    if (english.size >= 3 && !/\b(?:tae|nae|hae|auld|wi|ower|whit|mair)\b/i.test(text)) return 'en'
  }
  if (second && best[1] - second[1] < 0.008) return
  return canonicalTag(best[0])
}

export function detectDocumentLanguage(path: string, markdown: string): string | undefined {
  const frontmatter = /^\uFEFF?---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[^\S\r\n]*(?:\r?\n|$)/.exec(markdown)
  if (frontmatter) {
    const field = /^(?:lang|language):[ \t]*([^\r\n#]+)/im.exec(frontmatter[1])
    const value = field?.[1].trim().replace(/^(["'])(.*)\1$/, '$2').trim()
    const declared = value && canonicalTag(writtenNames[value.toLowerCase()] ?? value)
    if (declared) return declared
  }

  // Only accept conventional locale suffixes. A file such as notes.new.md or
  // article.id.md is commonly a revision or identifier, not language metadata.
  const suffix = /\.([a-z]{2}(?:[-_][a-z\d]{2,8})*|fil)\.(?:md|markdown|mdown)$/i.exec(path.split(/[\\/]/).at(-1) ?? '')?.[1]
  if (suffix && suffix.toLowerCase() !== 'id') {
    const fromName = canonicalTag(suffix)
    if (fromName) return fromName
  }

  const evidence = new Map<string, number>()
  let total = 0
  for (const sample of proseSamples(markdown.slice(frontmatter?.[0].length ?? 0))) {
    const letters = sample.match(/\p{L}/gu)?.length ?? 0
    if (letters < 5) continue
    const language = classify(sample, letters)
    // CJK prose conveys comparable information in fewer characters.
    const weight = letters + 2 * (sample.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0)
    total += weight
    if (language) evidence.set(language, (evidence.get(language) ?? 0) + weight)
  }
  const [best] = [...evidence].sort((a, b) => b[1] - a[1])
  return best && best[1] >= total * 0.62 ? best[0] : undefined
}
