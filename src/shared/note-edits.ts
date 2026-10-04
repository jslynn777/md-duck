import type { Note } from './types'

// Editing an opinion must not reset its review status, anchor, or creation date.
export function editNoteComment(notes: Note[], id: string, comment: string): Note[] {
  if (!comment.trim()) throw new Error('ERR_EMPTY_NOTE')
  if (!notes.some((note) => note.id === id)) throw new Error('ERR_NOTE_MISSING')
  return notes.map((note) => note.id === id ? { ...note, comment: comment.trim() } : note)
}
