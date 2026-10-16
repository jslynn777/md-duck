import { describe, expect, it } from 'vitest'
import { relocatePath, relocateScroll } from './library-relocation'

describe('exact library relocations', () => {
  it('only maps exact paths, including Unicode and Windows separators', () => {
    const from = 'C:\\文章库\\圣诞系列\\article.md'
    const to = 'C:\\文章库\\归档\\article.md'
    const relocations = [{ from, to }]
    expect(relocatePath(from, relocations)).toBe(to)
    expect(relocatePath(`${from}.backup`, relocations)).toBe(`${from}.backup`)
    expect(relocatePath('C:/文章库/圣诞系列/article.md', relocations)).toBe('C:/文章库/圣诞系列/article.md')
    expect(relocatePath('C:\\文章库\\圣诞系列', relocations)).toBe('C:\\文章库\\圣诞系列')
  })

  it('uses the original mapping once, including swaps and longer cycles', () => {
    const cycle = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }]
    expect(relocatePath('a', cycle)).toBe('b')
    expect(relocateScroll({ a: 'p-a', b: 'p-b', c: 'p-c' }, cycle)).toEqual({ b: 'p-a', c: 'p-b', a: 'p-c' })
    expect(relocateScroll({ a: 'p-a', b: 'p-b' }, [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]))
      .toEqual({ b: 'p-a', a: 'p-b' })
  })

  it('preserves all records in a chain blocked by an occupied target', () => {
    const scroll = { a: 'first-reading-place', b: 'second-place', c: 'third-place', unrelated: 'intro' }
    const result = relocateScroll(scroll, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])
    expect(result).toEqual(scroll)
    expect(scroll).toEqual({ a: 'first-reading-place', b: 'second-place', c: 'third-place', unrelated: 'intro' })
  })

  it('moves a chain into vacant destinations without treating it as successive renames', () => {
    expect(relocateScroll({ a: 'p-a', b: 'p-b' }, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]))
      .toEqual({ b: 'p-a', c: 'p-b' })
  })

  it('keeps ambiguous mappings and colliding sources rather than choosing a document', () => {
    expect(relocatePath('a', [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'a', to: 'b' }])).toBe('a')
    expect(relocateScroll({ a: 'p-a', b: 'p-b' }, [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }]))
      .toEqual({ a: 'p-a', b: 'p-b' })
    expect(relocatePath('a', [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }])).toBe('b')
  })

  it('follows separate rename, archive, and restore operations', () => {
    let scroll: Record<string, string> = { '/文章/原名.md': 'paragraph-17', '/other.md': 'intro' }
    scroll = relocateScroll(scroll, [{ from: '/文章/原名.md', to: '/文章/新名.md' }])
    scroll = relocateScroll(scroll, [{ from: '/文章/新名.md', to: '/归档/新名.md' }])
    scroll = relocateScroll(scroll, [{ from: '/归档/新名.md', to: '/文章/新名.md' }])
    expect(scroll).toEqual({ '/文章/新名.md': 'paragraph-17', '/other.md': 'intro' })
  })
})
