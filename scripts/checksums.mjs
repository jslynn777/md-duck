import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const directory = 'release'
const files = (await readdir(directory)).filter((name) => /^MD-Duck-.*\.(dmg|zip|exe)$/.test(name)).sort()
if (!files.length) throw new Error('No release archives found')
const lines = []
for (const file of files) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(join(directory, file))) hash.update(bytes)
  lines.push(`${hash.digest('hex')}  ${file}`)
}
await writeFile(join(directory, 'SHA256SUMS'), `${lines.join('\n')}\n`)
console.log(`Checksums written for ${files.length} archives.`)
