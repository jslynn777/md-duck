import { describe, expect, it } from 'vitest'
import { encodeKokoroPhonemes, kokoroStyleOffset } from './kokoro-runtime-tokenizer'

describe('Kokoro tokenizer compatibility', () => {
  it('uses the existing model character IDs and boundary tokens', () => {
    expect(encodeKokoroPhonemes('həlˈoʊ!')).toEqual([0, 50, 83, 54, 156, 57, 135, 5, 0])
  })
  it('removes unsupported symbols while preserving spaces and stress marks', () => {
    expect(encodeKokoroPhonemes('你h ə🎉ˈ')).toEqual([0, 50, 16, 83, 156, 0])
  })
  it('matches the previous tokenizer adding boundary tokens before right truncation', () => {
    const tokens = encodeKokoroPhonemes('a'.repeat(600))
    expect(tokens).toHaveLength(512)
    expect(tokens[0]).toBe(0)
    expect(tokens.at(-1)).toBe(43)
  })
  it('selects the same length-dependent voice style and caps the longest sequence', () => {
    expect(kokoroStyleOffset(2)).toBe(0)
    expect(kokoroStyleOffset(12)).toBe(10 * 256)
    expect(kokoroStyleOffset(512)).toBe(509 * 256)
  })
})
