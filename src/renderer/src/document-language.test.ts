import { describe, expect, it } from 'vitest'
import { detectDocumentLanguage, documentLanguageLabel } from './document-language'

const french = 'Imaginons qu’une marque de lingerie s’apprête à relancer sa culotte blanche taille haute. L’atelier a réservé un créneau de confection, mais la dentelle d’origine n’arrivera pas à temps.'
const english = 'The buyer wants a swatch before she decides how much fabric to order. She wants to know what happens to the finished edge when it is sewn to the dress.'
const chinese = '我想看看花边和素色裤身相接的那道缝，不能只看正面的花型。能不能请买手把原来的腰口翻过来拍一张照片？'

describe('document language evidence', () => {
  it('prefers explicit frontmatter, including regional tags, BOM, quotes and CRLF', () => {
    expect(detectDocumentLanguage('article.de.md', '\uFEFF---\r\nlang: "fr-CA" # publisher locale\r\n---\r\n' + english.repeat(20))).toBe('fr-CA')
    expect(detectDocumentLanguage('article.md', '---\nlanguage: French\n---\n')).toBe('fr')
    expect(detectDocumentLanguage('article.md', '---\nlanguage: 中文\n---\n')).toBe('zh')
    expect(detectDocumentLanguage('article.md', '---\nlang: id\n---\n')).toBe('id')
  })

  it('recognizes conventional locale suffixes across platforms', () => {
    expect(detectDocumentLanguage('C:\\notes\\article.zh-Hant.MD', french)).toBe('zh-Hant')
    expect(detectDocumentLanguage('journal/fragments/article.pt_BR.markdown', '')).toBe('pt-BR')
    expect(detectDocumentLanguage('article.fr.md', '---\nlang: xyz-fake\n---\n' + english)).toBe('fr')
  })

  it.each(['article.id.md', 'notes.new.md', '/notes.fr/article.md'])('does not treat %s as an explicit language', path => {
    expect(detectDocumentLanguage(path, french)).toBe('fr')
    expect(detectDocumentLanguage(path, '')).toBeUndefined()
  })

  it.each([
    ['fr', french], ['en', english], ['zh', chinese],
    ['de', 'Die Einkäuferin möchte die beiden Muster vergleichen, bevor sie den Stoff bestellt.'],
    ['es', 'La compradora quiere comparar el encaje con el tejido antes de hacer un pedido.'],
    ['ru', 'Статья написана на русском языке. Мы рассматриваем несколько важных вопросов, которые помогут нам понять, как работает эта система.'],
    ['ar', 'تريد المشترية مقارنة عينتين من الدانتيل قبل أن تقرر طلب القماش.'],
    ['ja', '模様を見るときには元の生地と見比べてください。'],
    ['ko', '회사는 원단을 주문하기 전에 샘플을 확인했습니다.'],
    ['it', 'Per preparare il nuovo ordine vorrei confrontare il campione con il tessuto della produzione precedente.'],
    ['pt', 'Gostaria de comparar as amostras antes de confirmar o novo pedido de tecidos para a nossa coleção.'],
  ])('reads %s from body prose without a filename hint', (tag, prose) => {
    expect(detectDocumentLanguage('article.md', prose)).toBe(tag)
  })

  it('uses the document text without treating code, paths, comments, image URLs or YAML as prose', () => {
    const noise = [
      '---\ntitle: ' + english.repeat(10) + '\n---',
      '<!-- ' + english + ' -->',
      '~~~js\n' + english.repeat(30) + '\n~~~',
      '`' + english + '`',
      '![Article reference](assets/an-english-name.png)',
      'https://example.test/a/really/long/file/name.html',
      'C:\\users\\someone\\documents\\an-old-project.md /home/user/documents/deep/file.md',
    ].join('\n\n')
    expect(detectDocumentLanguage('article.md', noise)).toBeUndefined()
    expect(detectDocumentLanguage('article.md', noise + '\n\n' + french)).toBe('fr')
  })

  it('declines a weak or evenly bilingual sample, and tolerates a short quotation', () => {
    for (const body of ['', 'HDL-1032', '12345', 'Yes?', 'The sample', 'x'.repeat(80)])
      expect(detectDocumentLanguage('article.md', body)).toBeUndefined()
    expect(detectDocumentLanguage('article.md', english + '\n\n' + french)).toBeUndefined()
    expect(detectDocumentLanguage('article.md', english + '\n\n' + english + '\n\n> Bonjour')).toBe('en')
  })
})

describe('document language labels', () => {
  it('localizes known tags while keeping reading controls short', () => {
    expect(documentLanguageLabel('fr-CA', 'zh', '原文')).toBe('法语')
    expect(documentLanguageLabel('fra', 'en', 'Source')).toBe('French')
    expect(documentLanguageLabel('es', 'en', 'Translation')).toBe('Spanish')
    expect(documentLanguageLabel('zh-Hans', 'zh', '译文')).toBe('中文')
    expect(documentLanguageLabel('en', 'zh', '原文')).toBe('英文')
  })
  it.each([undefined, '', 'und', 'zxx', 'mul', 'not a valid tag', 'zz'])('uses the supplied fallback for %s', tag => {
    expect(documentLanguageLabel(tag, 'en', 'Source')).toBe('Source')
    expect(documentLanguageLabel(tag, 'zh', '译文')).toBe('译文')
  })
})
