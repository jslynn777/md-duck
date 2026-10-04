import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

/** The first preferred system language sets first-run UI; saved choices take precedence. */
export function defaultUiLanguage(languages: readonly string[]): 'en' | 'zh' {
  return /^zh(?:[-_]|$)/i.test(languages[0] ?? '') ? 'zh' : 'en'
}

/** Capture each value before queuing it so an older write cannot win a race. */
export function createSettingsWriter(path: string) {
  let pending: Promise<void> = Promise.resolve()
  function write(value: unknown): Promise<void> {
    const content = JSON.stringify(value, null, 2)
    const next = pending.catch(() => undefined).then(async () => {
      await fs.mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        const handle = await fs.open(temporary, 'wx', 0o600)
        try { await handle.writeFile(content); await handle.sync() } finally { await handle.close() }
        await fs.rename(temporary, path)
      } finally { await fs.unlink(temporary).catch(() => undefined) }
    })
    pending = next
    return next
  }
  return { write, flush: () => pending }
}
