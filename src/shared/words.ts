export function wordKey(word: string) {
  return word.toLowerCase().replace(/[^a-z'’-]/g, '')
}

export function splitWords(value: string) {
  return value
    .split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g)
    .filter((text) => text.length > 0)
    .map((text) => ({ text, word: /^[A-Za-z]/.test(text) }))
}
