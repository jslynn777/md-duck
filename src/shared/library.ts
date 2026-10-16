import type { LibraryEntry } from './types'

export type ArticleStage = 'unmarked' | 'writing' | 'review' | 'done'
export type LibraryFolder = { path: string; name: string; parentPath: string; archived: boolean; fileIdentity?: string }
export type LibraryRelocation = { from: string; to: string }
export type LibrarySnapshot = { entries: LibraryEntry[]; folders: LibraryFolder[]; issue?: string }
export type LibraryChange = { snapshot: LibrarySnapshot; relocations: LibraryRelocation[]; root?: string; revision?: number }
export type LibraryCommand = (
  | { type: 'create-folder'; parent: string; name: string }
  | { type: 'create-articles'; folder: string; titles: string[] }
  | { type: 'rename'; path: string; name: string }
  | { type: 'move'; path: string; destination: string }
  | { type: 'archive'; path: string }
  | { type: 'restore'; path: string }
  | { type: 'stage'; path: string; stage: ArticleStage }
  | { type: 'reorder'; path: string; direction: 'up' | 'down' }

) & { documentId?: string; expectedIdentity?: string }
