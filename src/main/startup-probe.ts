import { promises as fs } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'

type Marker = 'window-visible' | 'renderer-loaded' | 'initialized' | 'state-served' | 'document-restored'

/** Opt-in package checks write timing only, exclusively inside an isolated test profile. */
export function createStartupProbe(profile: string | undefined, report: string | undefined, version: string) {
  const rel = profile && report ? relative(profile, report) : ''
  const enabled = !!profile && !!report && isAbsolute(report) && !!rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
  const started = performance.now()
  const markers: Partial<Record<Marker, number>> = {}
  let pending = Promise.resolve()
  function mark(name: Marker) {
    if (!enabled || markers[name] !== undefined) return
    markers[name] = Math.round(performance.now() - started)
    const snapshot = JSON.stringify({ version, platform: process.platform, markers })
    pending = pending.then(async () => {
      const temporary = `${report}.tmp`
      await fs.writeFile(temporary, snapshot, { flag: 'w', mode: 0o600 })
      await fs.rename(temporary, report!)
    }).catch(() => undefined)
  }
  return { mark }
}
