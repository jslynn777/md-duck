import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { FileMenuResult, LibraryEntry } from '../shared/types'
import { isPathInsideRoot } from './allowed-path'

export type FileMenuContext = { root: string | null; library: readonly LibraryEntry[]; revision: number }
export type FileMenuSession = {
  root: string
  rootReal: string
  revision: number
  sourcePath: string
  sourceReal: string
  translationPath: string | null
  translationReal: string | null
}

type FileActions = {
  reveal: (path: string) => void
  open: (path: string) => Promise<string>
  copy: (path: string) => void
}

function absolute(path: unknown): path is string {
  return typeof path === 'string' && isAbsolute(path) && !path.includes('\0')
}

async function existingTarget(path: string, root: string, markdown: boolean) {
  if (markdown && !/\.(md|markdown)$/i.test(path)) throw new Error('ERR_ONLY_MD')
  if (!(await isPathInsideRoot(path, root))) throw new Error('ERR_NOT_IN_FOLDER')
  const canonical = await realpath(path).catch(() => null)
  if (!canonical) throw new Error('ERR_NOT_FOUND')
  if (markdown && !/\.(md|markdown)$/i.test(canonical)) throw new Error('ERR_ONLY_MD')
  const info = await stat(canonical).catch(() => null)
  if (!info) throw new Error('ERR_NOT_FOUND')
  if (markdown ? !info.isFile() : !(info.isFile() || info.isDirectory())) throw new Error('ERR_NOT_FOUND')
  if (!(await isPathInsideRoot(canonical, root))) throw new Error('ERR_NOT_IN_FOLDER')
  return canonical
}

/** The toolbar may reveal the selected folder; it never follows a link outside it. */
export async function revealTarget(path: unknown, root: string | null): Promise<string> {
  if (!absolute(path) || !absolute(root)) throw new Error('ERR_NOT_IN_FOLDER')
  return existingTarget(path, root, false)
}

/** Only a current library row can grant native file actions. */
export function createFileActionService(getContext: () => FileMenuContext, actions: FileActions) {
  function matching(session: FileMenuSession) {
    const current = getContext()
    const entry = current.library.find((item) => item.path === session.sourcePath)
    if (current.root !== session.root || current.revision !== session.revision || !entry || entry.zhPath !== session.translationPath) {
      throw new Error('ERR_NOT_IN_FOLDER')
    }
    return current
  }

  return {
    async prepare(requested: unknown): Promise<FileMenuSession> {
      const context = getContext()
      if (!absolute(requested) || !absolute(context.root)) throw new Error('ERR_NOT_IN_FOLDER')
      const entry = context.library.find((item) => item.path === requested || item.zhPath === requested)
      if (!entry || !absolute(entry.path) || entry.zhPath !== null && !absolute(entry.zhPath)) throw new Error('ERR_NOT_IN_FOLDER')
      const rootReal = await realpath(context.root).catch(() => null)
      if (!rootReal) throw new Error('ERR_NOT_IN_FOLDER')
      const sourceReal = await existingTarget(entry.path, context.root, true)
      // A stale translation should not prevent actions on a valid original file.
      const translationReal = entry.zhPath ? await existingTarget(entry.zhPath, context.root, true).catch((error) => {
        if (requested === entry.zhPath) throw error
        return null
      }) : null
      const session: FileMenuSession = {
        root: context.root, rootReal, revision: context.revision,
        sourcePath: entry.path, sourceReal, translationPath: entry.zhPath, translationReal
      }
      matching(session)
      return session
    },

    async execute(session: FileMenuSession, choice: FileMenuResult, canceled: () => boolean = () => false): Promise<FileMenuResult | null> {
      if (canceled()) return null
      if (!['reveal', 'open-default', 'copy-path'].includes(choice.action) || !['source', 'translation'].includes(choice.target)) {
        throw new Error('ERR_NOT_IN_FOLDER')
      }
      matching(session)
      const path = choice.target === 'source' ? session.sourcePath : session.translationPath
      const expectedReal = choice.target === 'source' ? session.sourceReal : session.translationReal
      if (!path || !expectedReal) throw new Error('ERR_NOT_IN_FOLDER')
      const canonical = await existingTarget(path, session.root, true)
      const rootReal = await realpath(session.root).catch(() => null)
      matching(session)
      if (canonical !== expectedReal || rootReal !== session.rootReal) throw new Error('ERR_NOT_IN_FOLDER')
      if (canceled()) return null
      // Native file operations use the checked canonical path. Copying retains the user's root alias.
      if (choice.action === 'copy-path') actions.copy(path)
      else if (choice.action === 'reveal') actions.reveal(canonical)
      else {
        let error: string
        try { error = await actions.open(canonical) } catch { throw new Error('ERR_OPEN_FILE') }
        if (error) throw new Error('ERR_OPEN_FILE')
      }
      return choice
    }
  }
}

type Popup = { popup: (closed: () => void) => void; close: () => void }

/** Menu closure can precede an async click completion; only dismissal resolves null. */
export function presentFileMenu(deps: {
  create: (choose: (choice: FileMenuResult) => void) => Popup
  onWindowClosed: (cancel: () => void) => () => void
  execute: (choice: FileMenuResult, canceled: () => boolean) => Promise<FileMenuResult | null>
}): { result: Promise<FileMenuResult | null>; cancel: () => void } {
  let settled = false
  let selected = false
  let popup: Popup | undefined
  let unsubscribe: (() => void) | undefined
  let finish!: (value: FileMenuResult | null, error?: unknown) => void
  const result = new Promise<FileMenuResult | null>((resolve, reject) => {
    finish = (value, error) => {
      if (settled) return
      settled = true
      unsubscribe?.()
      if (error) reject(error)
      else resolve(value)
    }
  })
  const cancel = () => {
    if (settled) return
    finish(null)
    try { popup?.close() } catch { /* The native window may already be destroyed. */ }
  }
  try {
    popup = deps.create((choice) => {
      if (selected || settled) return
      selected = true
      void deps.execute(choice, () => settled).then((value) => finish(value), (error) => finish(null, error))
    })
    unsubscribe = deps.onWindowClosed(cancel)
    if (!settled) popup.popup(() => { if (!selected) finish(null) })
    else unsubscribe()
  } catch (error) { finish(null, error) }
  return { result, cancel }
}
