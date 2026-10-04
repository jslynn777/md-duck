import { describe, expect, it } from 'vitest'
import { editNoteComment } from './note-edits'
import type { Note } from './types'

const original: Note = { id: 'review', blockId: 'intro', blockKey: 'intro', quote: 'Original sentence.', quoteLang: 'source', comment: 'Before', createdAt: '2026-09-27T00:00:00Z', status: 'resolved' }

describe('editing a saved note', () => {
  it('preserves identity, quote, status, order and unrelated notes', () => {
    const other = { ...original, id: 'other' }
    const notes = [original, other]
    const edited = editNoteComment(notes, 'review', '  More precise request.\n')
    expect(edited).toEqual([{ ...original, comment: 'More precise request.' }, other])
    expect(edited[1]).toBe(other)
    expect(notes[0].comment).toBe('Before')
  })
  it('does not recreate a note deleted while its editor was open', () => {
    expect(() => editNoteComment([], 'review', 'New opinion')).toThrow('ERR_NOTE_MISSING')
  })
  it('rejects an empty comment without altering the saved note', () => {
    expect(() => editNoteComment([original], 'review', ' \n ')).toThrow('ERR_EMPTY_NOTE')
    expect(original.comment).toBe('Before')
  })
})
