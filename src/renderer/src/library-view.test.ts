import { describe, expect, it } from 'vitest'
import { emptyLibraryView, readLibraryView, writeLibraryView } from './library-view'

describe('space library views', () => {
  function storage() { const items = new Map<string, string>(); return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value) } } }
  it('remembers separate search and folder state by stable space identifier', () => {
    const saved = storage()
    writeLibraryView(saved, 'space-a', '/articles', { query: 'lace', archived: true, changedOnly: true, collapsed: ['/articles/series', '/unrelated'] })
    writeLibraryView(saved, 'space-b', '/journal', { query: 'silk', archived: false, changedOnly: false, collapsed: [] })
    expect(readLibraryView(saved, 'space-a', '/articles')).toEqual({ query: 'lace', archived: true, changedOnly: true, collapsed: ['/articles/series'] })
    expect(readLibraryView(saved, 'space-b', '/journal').query).toBe('silk')
  })
  it('restores relative folder state after a Mac or Windows root relocation', () => {
    const saved = storage()
    writeLibraryView(saved, 'space', 'C:\\Articles', { ...emptyLibraryView(), collapsed: ['c:\\Articles\\series\\chapter'] })
    expect(readLibraryView(saved, 'space', 'D:\\Writing').collapsed).toEqual(['D:\\Writing\\series\\chapter'])
    expect(readLibraryView(saved, 'space', '/Volumes/Writing').collapsed).toEqual(['/Volumes/Writing/series/chapter'])
  })
  it('ignores malformed or unsafe saved folder paths', () => {
    expect(readLibraryView({ getItem: () => '{bad' }, 'space', '/articles')).toEqual(emptyLibraryView())
    expect(readLibraryView({ getItem: () => JSON.stringify({ version: 1, collapsed: ['../other', '/root', 'safe', 'a//b'] }) }, 'space', '/articles').collapsed).toEqual(['/articles/safe'])
  })
})
