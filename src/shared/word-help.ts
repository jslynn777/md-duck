export interface DictionaryResult {
  word: string
  status: 'found' | 'not-found' | 'unavailable'
  pronunciations: Array<{ ipa: string; accent?: 'uk' | 'us' }>
  definitions: Array<{ partOfSpeech: string; definition: string; example?: string }>
  sourceUrl?: string
  license?: { name: string; url: string }
}

export interface WordExplanation {
  lemma: string
  partOfSpeech: string
  meaning: string
  formNote?: string
  usage?: string
  example?: { en: string; zh: string }
  memoryHint?: string
  confusion?: string
}
