import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error(`Missing --${name} value`)
  return process.argv[index + 1]
}

const platform = option('platform', process.platform)
const check = option('check', 'speech')
if (!['darwin', 'win32'].includes(platform)) throw new Error(`Unsupported packaging check platform: ${platform}`)
if (!['speech', 'startup'].includes(check)) throw new Error(`Unknown packaging check: ${check}`)
if (process.platform !== platform) throw new Error(`Run the ${platform} runtime check on a ${platform} host`)
const app = resolve(option('app-root', platform === 'win32' ? 'release/win-unpacked' : 'release/mac-arm64/MD Duck.app'))
const executable = platform === 'win32' ? join(app, 'MD Duck.exe') : join(app, 'Contents/MacOS/MD Duck')
const resources = platform === 'win32' ? join(app, 'resources') : join(app, 'Contents/Resources')
const script = resolve(check === 'speech' ? 'scripts/verify-speech-runtime.cjs' : 'scripts/verify-startup.cjs')
for (const file of [executable, script, join(resources, 'app.asar')]) {
  if (!existsSync(file)) throw new Error(`Required packaged check file is missing: ${file}`)
}
const environment = { ...process.env }
delete environment.NODE_OPTIONS
if (check === 'speech') environment.ELECTRON_RUN_AS_NODE = '1'
else delete environment.ELECTRON_RUN_AS_NODE
const command = check === 'startup' ? process.execPath : executable
const arguments_ = [script, join(resources, 'app.asar')]
if (check === 'startup') arguments_.push('--exe', executable)
const result = spawnSync(command, arguments_, {
  env: environment,
  stdio: 'inherit',
  windowsHide: false,
  timeout: 120_000
})
if (result.error) throw result.error
if (result.signal) throw new Error(`Packaged ${check} check terminated: ${result.signal}`)
process.exitCode = result.status ?? 1
