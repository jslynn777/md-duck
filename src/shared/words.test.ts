import { describe, expect, it } from 'vitest'
import { splitWords, wordKey } from './words'

describe('words', () => {
  it('keeps punctuation beside the word', () => {
    expect(splitWords("It's a ribbon.")).toEqual([
      { text: "It's", word: true },
      { text: ' ', word: false },
      { text: 'a', word: true },
      { text: ' ', word: false },
      { text: 'ribbon', word: true },
      { text: '.', word: false }
    ])
  })

  it('normalizes a clicked word', () => {
    expect(wordKey("Ribbon's")).toBe("ribbon's")
  })
})