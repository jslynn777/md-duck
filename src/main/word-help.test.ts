import { describe, expect, it, vi } from 'vitest'
import { createWordHelpService, lookupLocalPronunciations, parseDictionaryResponse, parseWordExplanation } from './word-help'

const credentials = { key: 'test-only-key', model: 'test/model' }
const basic = { lemma: 'bank', partOfSpeech: '名词', meaning: '河岸' }
const detailed = {
  ...basic,
  usage: 'on the bank：在岸边',
  example: { en: 'We rested on the bank.', zh: '我们在岸边休息。' },
  memoryHint: '联想助记：把这个义项和河边的景象联系起来。',
  confusion: '这里不是金融机构。'
}
const noLocal = () => null
const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status })
const aiResponse = (payload: unknown) => jsonResponse({ choices: [{ message: { content: JSON.stringify(payload) } }] })
const dictionaryPayload = (word = 'bank') => [{
  word,
  phonetics: [
    { text: '/bæŋk/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/bank-uk.mp3' },
    { text: '/bæŋk/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/bank-us.mp3' }
  ],
  meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'The edge of a river.', example: 'A grassy bank.' }] }],
  sourceUrls: ['https://en.wiktionary.org/wiki/bank'],
  license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' }
}]

describe('dictionary pronunciation lookup', () => {
  it('returns actual bundled pronunciations for the selected inflected form without network access', async () => {
    const fetcher = vi.fn(async () => { throw new Error('Offline') })
    const service = createWordHelpService({ fetcher })
    const running = await service.lookupDictionary('Running')
    expect(running.status).toBe('found')
    expect(running.pronunciations).toContainEqual({ ipa: '/ɹˈʌnɪŋ/', accent: 'uk' })
    expect(running.pronunciations).toContainEqual({ ipa: '/ˈɹənɪŋ/', accent: 'us' })
    expect(running.pronunciations).not.toEqual(lookupLocalPronunciations('run')?.pronunciations)
    expect(running.sourceUrl).toContain('43c3570eb3553bdd19fccd2bd0091534889af023')
    expect(running.license?.name).toBe('MIT / GPL-3.0')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves source and license metadata from the online dictionary', () => {
    expect(parseDictionaryResponse('bank', dictionaryPayload())).toEqual({
      word: 'bank', status: 'found',
      pronunciations: [{ ipa: '/bæŋk/', accent: 'uk' }, { ipa: '/bæŋk/', accent: 'us' }],
      definitions: [{ partOfSpeech: 'noun', definition: 'The edge of a river.', example: 'A grassy bank.' }],
      sourceUrl: 'https://en.wiktionary.org/wiki/bank',
      license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' }
    })
  })

  it('rejects malformed, unrelated, or oversized external fields and unsafe links', () => {
    const result = parseDictionaryResponse('bank', [{
      word: 'bank',
      phonetics: [{ text: '<script>bad</script>' }, { text: 'x'.repeat(121) }, { text: '/bæŋk/' }],
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 12 }, { definition: 'x'.repeat(1201) }] }],
      sourceUrls: ['javascript:alert(1)'],
      license: { name: 'unsafe', url: 'file:///private/data' }
    }, ...dictionaryPayload('other')])
    expect(result.pronunciations).toEqual([{ ipa: '/bæŋk/' }])
    expect(result.definitions).toEqual([])
    expect(result.license).toBeUndefined()
    expect(result.sourceUrl).toBe('https://api.dictionaryapi.dev/api/v2/entries/en/bank')
    expect(parseDictionaryResponse('bank', { phonetic: '/bæŋk/' }).status).toBe('unavailable')
    expect(parseDictionaryResponse('bank', dictionaryPayload('other')).status).toBe('unavailable')
  })

  it('deduplicates lookup requests, sends only the word, and caches successful results', async () => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((done) => { resolve = done }))
    const service = createWordHelpService({ fetcher, localLookup: noLocal })
    const first = service.lookupDictionary('BANK')
    const second = service.lookupDictionary('bank')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('https://api.dictionaryapi.dev/api/v2/entries/en/bank')
    expect(fetcher.mock.calls[0][1]).toEqual({ signal: expect.any(AbortSignal) })
    resolve(jsonResponse(dictionaryPayload()))
    expect(await first).toEqual(await second)
    await service.lookupDictionary('bank')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('returns failure states and permits retry instead of caching failures', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(new Response('not JSON'))
      .mockResolvedValueOnce(jsonResponse(dictionaryPayload()))
    const service = createWordHelpService({ fetcher, localLookup: noLocal })
    expect((await service.lookupDictionary('bank')).status).toBe('not-found')
    expect((await service.lookupDictionary('bank')).status).toBe('unavailable')
    expect((await service.lookupDictionary('bank')).status).toBe('unavailable')
    expect((await service.lookupDictionary('bank')).status).toBe('found')
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('turns dictionary timeouts into an unavailable result without fabricating IPA', async () => {
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Timeout')), { once: true })
    }))
    const service = createWordHelpService({ fetcher, localLookup: noLocal, dictionaryTimeoutMs: 10 })
    expect(await service.lookupDictionary('bank')).toEqual({ word: 'bank', status: 'unavailable', pronunciations: [], definitions: [] })
  })

  it('bounds successful online dictionary cache entries', async () => {
    const fetcher = vi.fn(async (url: string) => jsonResponse(dictionaryPayload(url.split('/').at(-1))))
    const service = createWordHelpService({ fetcher, localLookup: noLocal, cacheSize: 2 })
    await service.lookupDictionary('bank')
    await service.lookupDictionary('road')
    await service.lookupDictionary('house')
    await service.lookupDictionary('bank')
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
})

describe('structured word explanations', () => {
  it('accepts JSON and a single JSON code fence while returning only known fields', () => {
    expect(parseWordExplanation(JSON.stringify({ ...basic, ipa: '/fake/', unknown: 'hidden' }), false)).toEqual(basic)
    expect(parseWordExplanation('```json\n' + JSON.stringify(detailed) + '\n```', true)).toEqual(detailed)
    expect(parseWordExplanation(JSON.stringify(detailed), false)).toEqual(basic)
  })

  it.each([null, '', ' \n\t'])('omits blank optional fields without rejecting useful details: %s', (empty) => {
    expect(parseWordExplanation(JSON.stringify({
      ...basic, formNote: empty, usage: detailed.usage,
      memoryHint: empty, confusion: empty, example: empty
    }), true)).toEqual({ ...basic, usage: detailed.usage })
    expect(parseWordExplanation(JSON.stringify({ ...basic, formNote: empty }), false)).toEqual(basic)
  })

  it('omits an empty example but rejects a partially supplied or incorrectly typed example', () => {
    expect(parseWordExplanation(JSON.stringify({
      ...basic, usage: detailed.usage, example: { en: null, zh: '  ' }
    }), true)).toEqual({ ...basic, usage: detailed.usage })
    for (const example of [{ en: 'A river bank.', zh: null }, { en: false, zh: '' }, 'A river bank.']) {
      expect(() => parseWordExplanation(JSON.stringify({ ...detailed, example }), true)).toThrow('ERR_BAD_EXPLANATION')
    }
  })

  it.each(['lemma', 'partOfSpeech', 'meaning'])('keeps the required %s field strict despite optional-field tolerance', (field) => {
    for (const invalid of [null, '', ' \n', 12]) {
      expect(() => parseWordExplanation(JSON.stringify({ ...basic, [field]: invalid }), false)).toThrow('ERR_BAD_EXPLANATION')
    }
  })

  it('requires useful detail and rejects nonempty malformed optional fields', () => {
    for (const extra of [
      {}, { usage: '', example: null, memoryHint: ' ' },
      { formNote: '原形未变化', confusion: '不是银行' },
      { usage: detailed.usage, memoryHint: [] },
      { usage: 'x'.repeat(1201) }
    ]) {
      expect(() => parseWordExplanation(JSON.stringify({ ...basic, ...extra }), true)).toThrow('ERR_BAD_EXPLANATION')
    }
    for (const extra of [{ usage: detailed.usage }, { example: detailed.example }, { memoryHint: detailed.memoryHint }]) {
      expect(parseWordExplanation(JSON.stringify({ ...basic, ...extra }), true)).toEqual({ ...basic, ...extra })
    }
  })

  it.each([
    'plain prose instead of JSON', 'null', '[]', '{"lemma":"bank"}',
    JSON.stringify({ ...basic, meaning: 12 }),
    JSON.stringify({ ...basic, meaning: ' ' }),
    JSON.stringify({ ...basic, meaning: 'x'.repeat(801) }),
    JSON.stringify({ ...basic, formNote: [] }),
    JSON.stringify({ ...detailed, example: { en: 'missing Chinese' } }),
    JSON.stringify({ ...detailed, memoryHint: { unsupported: true } })
  ])('rejects invalid generated content with a stable error: %s', (raw) => {
    expect(() => parseWordExplanation(raw, true)).toThrow('ERR_BAD_EXPLANATION')
  })

  it('keeps sentence, detail level, and model distinct in its cache', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const { sentence } = JSON.parse(body.messages[1].content)
      return aiResponse({ ...basic, usage: detailed.usage, meaning: sentence.includes('river') ? '河岸' : '银行' })
    })
    const service = createWordHelpService({ fetcher })
    const river = await service.explainWord('bank', 'We sat by the river bank.', false, credentials)
    const money = await service.explainWord('bank', 'I work at the bank.', false, credentials)
    expect(river.meaning).toBe('河岸')
    expect(money.meaning).toBe('银行')
    await service.explainWord('bank', 'I work at the bank.', false, credentials)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await service.explainWord('bank', 'I work at the bank.', true, credentials)
    await service.explainWord('bank', 'I work at the bank.', false, { ...credentials, model: 'another/model' })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('isolates explanations by provider, endpoint and account', async () => {
    const fetcher = vi.fn(async () => aiResponse(basic))
    const service = createWordHelpService({ fetcher })
    for (const config of [
      credentials,
      { ...credentials, provider: 'deepseek' as const, baseUrl: 'https://api.deepseek.com' },
      { ...credentials, provider: 'custom' as const, baseUrl: 'https://example.com/v1' },
      { ...credentials, provider: 'custom' as const, baseUrl: 'https://other.example.com/v1' },
      { ...credentials, key: 'second-test-account' }
    ]) await service.explainWord('bank', 'A river bank.', false, config)
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it('deduplicates an explanation in flight and instructs the model to avoid invented IPA and etymology', async () => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((done) => { resolve = done }))
    const service = createWordHelpService({ fetcher })
    const first = service.explainWord('bank', 'A river bank.', true, credentials)
    const second = service.explainWord('bank', 'A river bank.', true, credentials)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(request.messages[0].content).toContain('禁止生成 IPA')
    expect(request.messages[0].content).toContain('不得把联想助记说成真实词源')
    expect(JSON.parse(request.messages[1].content)).toEqual({ selectedWord: 'bank', sentence: 'A river bank.' })
    resolve(aiResponse(detailed))
    expect(await first).toEqual(detailed)
    expect(await second).toEqual(detailed)
  })

  it('preserves the selected spelling when capitalization changes the meaning', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body))
      const { selectedWord } = JSON.parse(request.messages[1].content)
      return aiResponse({ lemma: selectedWord, partOfSpeech: '形容词或动词', meaning: selectedWord === 'Polish' ? '波兰的' : '擦亮' })
    })
    const service = createWordHelpService({ fetcher })
    const sentence = 'Polish workers polish the furniture.'
    expect((await service.explainWord('Polish', sentence, false, credentials)).meaning).toBe('波兰的')
    expect((await service.explainWord('polish', sentence, false, credentials)).meaning).toBe('擦亮')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([[401, 'ERR_BAD_KEY'], [402, 'ERR_NO_CREDIT'], [400, 'ERR_MODEL'], [404, 'ERR_MODEL'], [429, 'ERR_RATE_LIMIT']])
  ('preserves provider status %s as error %s', async (status, error) => {
    const service = createWordHelpService({ fetcher: async () => jsonResponse({}, Number(status)) })
    await expect(service.explainWord('bank', 'A bank.', false, credentials)).rejects.toThrow(String(error))
  })

  it('permits retry after network or malformed-response failures and never exposes the raw JSON', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(new Response('bad envelope'))
      .mockResolvedValueOnce(aiResponse({ secret: 'raw provider text' }))
      .mockResolvedValueOnce(aiResponse(basic))
    const service = createWordHelpService({ fetcher })
    await expect(service.explainWord('bank', 'A bank.', false, credentials)).rejects.toThrow('ERR_NETWORK')
    await expect(service.explainWord('bank', 'A bank.', false, credentials)).rejects.toThrow('ERR_BAD_EXPLANATION')
    await expect(service.explainWord('bank', 'A bank.', false, credentials)).rejects.toThrow('ERR_BAD_EXPLANATION')
    expect(await service.explainWord('bank', 'A bank.', false, credentials)).toEqual(basic)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('bounds successful explanation cache entries and requires a key before making requests', async () => {
    const fetcher = vi.fn(async () => aiResponse(basic))
    const service = createWordHelpService({ fetcher, cacheSize: 2 })
    await expect(service.explainWord('bank', 'A bank.', false, { ...credentials, key: '' })).rejects.toThrow('NO_KEY')
    expect(fetcher).not.toHaveBeenCalled()
    for (const sentence of ['one', 'two', 'three', 'one']) await service.explainWord('bank', sentence, false, credentials)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
})
