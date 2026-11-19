import { spawn, execFile, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { codexTaskIsActive, type CodexApproval, type CodexApprovalResponse, type CodexTask, type CodexTaskInput, type CodexTaskPhase, type CodexTaskSnapshot } from '../shared/codex-task'
import { normalizeSpaceArticlePath, validSpaceId } from '../shared/spaces'
import { isPathInsideRoot } from './allowed-path'
import { createSettingsWriter } from './settings-store'

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, limit = 20_000) => typeof value === 'string' ? value.slice(0, limit) : ''
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
const phases: CodexTaskPhase[] = ['starting', 'running', 'waiting-approval', 'waiting-input', 'review', 'stopping', 'stopped', 'taken-over', 'failed', 'disconnected']
const samePath = (a: string, b: string, platform: NodeJS.Platform) => platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)

export type CodexDiscoveryOptions = { executable?: string; platform?: NodeJS.Platform; arch?: string; env?: NodeJS.ProcessEnv; home?: string }

/** Resolve npm's public native package layout; never run a .cmd shim through a shell. */
export async function discoverCodexExecutable(options: CodexDiscoveryOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform, arch = options.arch ?? process.arch, env = options.env ?? process.env, home = options.home ?? homedir()
  const binary = platform === 'win32' ? 'codex.exe' : 'codex'
  const target = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-${platform === 'darwin' ? 'apple-darwin' : platform === 'win32' ? 'pc-windows-msvc' : 'unknown-linux-musl'}`
  const directories = [...(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter),
    ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : []),
    join(home, '.local', 'bin'), join(home, '.cargo', 'bin'), join(home, '.npm-global', 'bin'),
    ...(platform === 'win32' && env.APPDATA ? [join(env.APPDATA, 'npm')] : [])].filter(Boolean)
  const candidates = options.executable ? [options.executable] : directories.flatMap(dir => [join(dir, binary), ...(platform === 'win32' ? [join(dir, 'codex.cmd')] : [])])
  for (const candidate of [...new Set(candidates)]) {
    const actual = await fs.realpath(candidate).catch(() => null)
    if (!actual || !(await fs.stat(actual).catch(() => null))?.isFile()) continue
    const handle = await fs.open(actual, 'r').catch(() => null)
    if (!handle) continue
    const header = Buffer.alloc(96)
    try { await handle.read(header, 0, header.length, 0) } finally { await handle.close() }
    const shim = /\.(?:cmd|bat|js|mjs|cjs)$/i.test(actual) || header.subarray(0, 2).toString() === '#!'
    if (!shim) return actual
    const packageRoots = /\.[cm]?js$/i.test(actual) ? [resolve(dirname(actual), '..')] : [join(dirname(actual), 'node_modules', '@openai', 'codex')]
    for (const packageRoot of packageRoots) {
      const metadata = await fs.readFile(join(packageRoot, 'package.json'), 'utf8').then(JSON.parse).catch(() => null)
      if (metadata?.name !== '@openai/codex') continue
      const vendorRoots = [join(packageRoot, 'vendor')]
      try { vendorRoots.unshift(join(dirname(createRequire(join(packageRoot, 'package.json')).resolve(`@openai/codex-${platform}-${arch}/package.json`)), 'vendor')) } catch { /* Older packages use their own vendor directory. */ }
      for (const vendor of vendorRoots) {
        const native = join(vendor, target, 'bin', binary)
        if ((await fs.stat(native).catch(() => null))?.isFile()) return fs.realpath(native)
      }
    }
  }
  return null
}

export type CodexProtocolDiagnostic = {
  event: 'request' | 'resolved' | 'rejected' | 'timeout' | 'spawn' | 'close' | 'exit'
  connection: number
  method?: string
  requestId?: string
}

export type CodexRunnerOptions = {
  spaceId: string
  root: string
  storePath: string
  appVersion?: string
  onChange?: (state: CodexTaskSnapshot) => void
  /** Protocol metadata only: never receives request parameters or response content. */
  onDiagnostic?: (event: CodexProtocolDiagnostic) => void
  platform?: NodeJS.Platform
  executable?: string
  discoverExecutable?: () => Promise<string | null>
  spawnProcess?: (command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams
  terminateProcess?: (child: ChildProcessWithoutNullStreams) => Promise<void>
  requestTimeoutMs?: number
  stopTimeoutMs?: number
  snapshotFiles?: () => Promise<Record<string, string>>
  snapshotTimeoutMs?: number
}

/** One dedicated stdio app-server and one owned task thread per local article space. */
export function createCodexRunner(options: CodexRunnerOptions) {
  if (!validSpaceId(options.spaceId) || !isAbsolute(options.root) || !isAbsolute(options.storePath)) throw Error('ERR_CODEX_CONFIG')
  const platform = options.platform ?? process.platform, root = resolve(options.root)
  const writer = createSettingsWriter(options.storePath)
  let state: CodexTaskSnapshot = { spaceId: options.spaceId, root, availability: { state: 'unknown' }, task: null, approvals: [] }
  let initialization: Promise<CodexTaskSnapshot> | undefined, storageBlocked = false, disposed = false, busy = false
  let child: ChildProcessWithoutNullStreams | undefined, connecting: Promise<void> | undefined, connection = 0, sequence = 0
  let saveTimer: NodeJS.Timeout | undefined, stopIntent: 'stopped' | 'taken-over' | undefined
  let stopFlight: Promise<CodexTaskSnapshot> | undefined
  let disposeFlight: Promise<void> | undefined
  let turnRequested = false
  const closing = new Set<ChildProcessWithoutNullStreams>()
  const terminations = new Map<ChildProcessWithoutNullStreams, Promise<void>>()
  const fileChanges = new Map<string, { path: string; diff?: string }[]>()
  const earlyCompletions = new Map<string, Record<string, any>>()
  let fileBaseline: { task: CodexTask; files?: Record<string, string> } | undefined
  let completion: { task: CodexTask; turnId: string; flight: Promise<void> } | undefined
  const pending = new Map<string, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout; method: string; connection: number }>()
  const approvals = new Map<string, { rpcId: string | number; method: string; public: CodexApproval }>()
  const terminalWaiters = new Set<() => void>()
  const status = (): CodexTaskSnapshot => structuredClone(state)
  const now = () => new Date().toISOString()
  function diagnostic(event: CodexProtocolDiagnostic) {
    try { options.onDiagnostic?.(event) } catch { /* Diagnostics cannot alter process control. */ }
  }

  function notify(persist = true) {
    if (state.task) state.task.updatedAt = now()
    state.approvals = [...approvals.values()].map(entry => entry.public)
    try { options.onChange?.(status()) } catch { /* A closed UI cannot terminate a task. */ }
    if (persist && !storageBlocked && !saveTimer) saveTimer = setTimeout(() => { saveTimer = undefined; void save().catch(() => { if (state.task) state.task.error = 'ERR_CODEX_STORAGE'; notify(false) }) }, 200)
  }
  async function save() {
    if (storageBlocked) throw Error('ERR_CODEX_STORAGE')
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = undefined
    await writer.write({ version: 1, spaceId: options.spaceId, task: state.task })
  }
  function message(id: string, kind: 'assistant' | 'command' | 'file-change' | 'status', value: string, append = false) {
    const task = state.task
    if (!task || !value) return
    const found = task.messages.find(item => item.id === id)
    if (found) { found.text = text(append ? found.text + value : value); found.kind = kind }
    else task.messages.push({ id, kind, text: text(value), at: now() })
    task.messages = task.messages.slice(-100)
    notify()
  }
  function initialize(): Promise<CodexTaskSnapshot> {
    return initialization ??= (async () => {
      try {
        const bytes = await fs.readFile(options.storePath, 'utf8')
        if (bytes.length > 4_000_000) throw Error('ERR_CODEX_STORAGE')
        const saved = JSON.parse(bytes)
        if (!record(saved) || saved.version !== 1 || saved.spaceId !== options.spaceId || !(saved.task === null || validTask(saved.task))) throw Error('ERR_CODEX_STORAGE')
        state.task = saved.task
        if (state.task && (codexTaskIsActive(state.task) || !samePath(state.task.root, root, platform))) {
          state.task.phase = 'disconnected'; state.task.activity = 'disconnected'
          state.task.error = samePath(state.task.root, root, platform) ? 'ERR_CODEX_DISCONNECTED' : 'ERR_CODEX_ROOT_CHANGED'
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { storageBlocked = true; state.availability = { state: 'error', message: 'ERR_CODEX_STORAGE' } }
      }
      notify(false)
      return status()
    })()
  }
  function validTask(task: unknown): task is CodexTask {
    return record(task) && identifier(task.id) && typeof task.root === 'string' && task.root.length <= 4096 && isAbsolute(task.root) && phases.includes(task.phase) &&
      typeof task.prompt === 'string' && task.prompt.length <= 20_000 && typeof task.activity === 'string' && task.activity.length <= 1000 && typeof task.startedAt === 'string' && typeof task.updatedAt === 'string' &&
      (task.error === undefined || typeof task.error === 'string') && (task.relativePath === undefined || typeof task.relativePath === 'string') &&
      (task.threadId === undefined || identifier(task.threadId)) && (task.turnId === undefined || identifier(task.turnId)) &&
      Array.isArray(task.messages) && task.messages.length <= 100 && task.messages.every((item: unknown) => record(item) && typeof item.id === 'string' && ['assistant', 'command', 'file-change', 'status'].includes(item.kind) && typeof item.text === 'string' && item.text.length <= 20_000 && typeof item.at === 'string') &&
      Array.isArray(task.changedFiles) && task.changedFiles.length <= 200 && task.changedFiles.every((file: unknown) => typeof file === 'string' && file.length <= 4096)
  }
  function write(value: unknown) {
    if (!child || child.stdin.destroyed) throw Error('ERR_CODEX_DISCONNECTED')
    child.stdin.write(JSON.stringify(value) + '\n')
  }
  function request(method: string, params: unknown): Promise<any> {
    const id = `mdduck-${++sequence}`
    const generation = connection
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); diagnostic({ event: 'timeout', method, requestId: id, connection: generation }); reject(Error('ERR_CODEX_TIMEOUT')) }, options.requestTimeoutMs ?? 15_000)
      pending.set(id, { resolve, reject, timer, method, connection: generation })
      diagnostic({ event: 'request', method, requestId: id, connection: generation })
      try { write({ id, method, params }) } catch (error) { clearTimeout(timer); pending.delete(id); diagnostic({ event: 'rejected', method, requestId: id, connection: generation }); reject(error) }
    })
  }
  function rejectPending() {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer); diagnostic({ event: 'rejected', method: entry.method, requestId: id, connection: entry.connection }); entry.reject(Error('ERR_CODEX_DISCONNECTED'))
    }
    pending.clear()
  }
  function disconnected() {
    rejectPending(); approvals.clear()
    if (codexTaskIsActive(state.task)) {
      state.task!.phase = 'disconnected'; state.task!.activity = 'disconnected'; state.task!.error = 'ERR_CODEX_DISCONNECTED'
    }
    for (const resolve of terminalWaiters) resolve()
    notify()
  }
  async function terminate(owned: ChildProcessWithoutNullStreams) {
    if (options.terminateProcess) return options.terminateProcess(owned)
    if (owned.exitCode !== null || owned.signalCode !== null) return
    const waitExit = (ms: number) => new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); owned.removeListener('exit', done); resolve() }
      const timer = setTimeout(done, ms); owned.once('exit', done)
    })
    owned.stdin.end()
    await waitExit(400)
    if (owned.exitCode !== null || owned.signalCode !== null) return
    if (platform === 'win32' && owned.pid) {
      await new Promise<void>(resolve => execFile('taskkill.exe', ['/PID', String(owned.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve()))
    } else if (owned.pid) {
      try { process.kill(-owned.pid, 'SIGTERM') } catch { owned.kill('SIGTERM') }
    }
    await waitExit(1000)
    if (owned.exitCode === null && owned.signalCode === null) {
      if (platform !== 'win32' && owned.pid) { try { process.kill(-owned.pid, 'SIGKILL') } catch { owned.kill('SIGKILL') } }
      else owned.kill('SIGKILL')
      await waitExit(1000)
    }
    if (owned.exitCode === null && owned.signalCode === null) throw Error('ERR_CODEX_STOP_UNCONFIRMED')
  }
  async function close() {
    const owned = child
    diagnostic({ event: 'close', connection })
    child = undefined; connecting = undefined; connection += 1
    rejectPending(); approvals.clear()
    if (owned) closing.add(owned)
    for (const process of closing) {
      let completion = terminations.get(process)
      if (!completion) { completion = terminate(process).then(() => { closing.delete(process) }).finally(() => { terminations.delete(process) }); terminations.set(process, completion) }
      await completion
    }
  }
  async function connect() {
    if (disposed) throw Error('ERR_CODEX_CLOSED')
    if (closing.size) throw Error('ERR_CODEX_STOP_UNCONFIRMED')
    if (connecting) return connecting
    const attempt = connection
    connecting = (async () => {
      const executable = await (options.discoverExecutable?.() ?? discoverCodexExecutable({ executable: options.executable, platform }))
      if (disposed || attempt !== connection || (busy && stopIntent)) throw Error('ERR_CODEX_CANCELED')
      if (!executable) { state.availability = { state: 'not-installed', message: 'ERR_CODEX_NOT_INSTALLED' }; throw Error('ERR_CODEX_NOT_INSTALLED') }
      state.availability = { state: 'unknown', executable }
      const args = ['app-server', '--listen', 'stdio://', '-c', 'sandbox_workspace_write.writable_roots=[]', '-c', 'sandbox_workspace_write.network_access=false', '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true', '-c', 'sandbox_workspace_write.exclude_slash_tmp=true']
      const owned = (options.spawnProcess ?? ((command, args, configuration) => spawn(command, args, { ...configuration, stdio: ['pipe', 'pipe', 'pipe'] })))(executable, args, { cwd: root, shell: false, windowsHide: true, detached: platform !== 'win32' })
      child = owned
      const generation = ++connection
      diagnostic({ event: 'spawn', connection: generation })
      let buffer = ''
      owned.stdout.setEncoding('utf8')
      owned.stdout.on('data', (chunk: string) => {
        if (generation !== connection) return
        buffer += chunk
        if (buffer.length > 4_000_000) { disconnected(); void close().catch(() => undefined); return }
        let end: number
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
          if (!line.trim()) continue
          try { receive(JSON.parse(line)) } catch { disconnected(); void close().catch(() => undefined); return }
        }
      })
      // Drain stderr without persisting credentials or dumping arbitrary environment details.
      owned.stderr.on('data', () => undefined)
      owned.stdin.on('error', () => { if (generation === connection) disconnected() })
      owned.once('error', () => { if (generation === connection) disconnected() })
      owned.once('exit', () => { diagnostic({ event: 'exit', connection: generation }); if (generation === connection) { child = undefined; connecting = undefined; disconnected() } })
      await request('initialize', { clientInfo: { name: 'md-duck', version: options.appVersion ?? '0.1.0' }, capabilities: { experimentalApi: false } })
      write({ method: 'initialized', params: {} })
      const account = await request('account/read', { refreshToken: false })
      if (!record(account) || typeof account.requiresOpenaiAuth !== 'boolean') throw Error('ERR_CODEX_PROTOCOL')
      if (!account.account && account.requiresOpenaiAuth) { state.availability = { state: 'not-logged-in', executable, message: 'ERR_CODEX_LOGIN_REQUIRED' }; throw Error('ERR_CODEX_LOGIN_REQUIRED') }
      if (platform === 'win32') {
        const readiness = await request('windowsSandbox/readiness', null)
        if (readiness.status !== 'ready') { state.availability = { state: 'unsupported', executable, message: 'ERR_CODEX_WINDOWS_SANDBOX' }; throw Error('ERR_CODEX_WINDOWS_SANDBOX') }
      }
      state.availability = { state: 'ready', executable, accountType: text(account.account?.type, 50) || 'external' }
      notify(false)
    })()
    try { await connecting } catch (error) {
      if (state.availability.state === 'unknown') state.availability = { ...state.availability, state: 'error', message: errorCode(error) }
      await close().catch(() => undefined); notify(false); throw error
    }
  }
  function errorCode(error: unknown) { return error instanceof Error && /^ERR_CODEX_[A-Z_]+$/.test(error.message) ? error.message : 'ERR_CODEX_CONNECTION' }
  function matches(params: Record<string, any>) {
    return !!state.task?.threadId && params.threadId === state.task.threadId && (!params.turnId || !state.task.turnId || params.turnId === state.task.turnId)
  }
  function fileWithinRoot(value: string): string | null {
    if (!value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) return null
    const file = relative(root, resolve(root, value)).replaceAll('\\', '/')
    return file && file !== '..' && !file.startsWith('../') && !isAbsolute(file) ? file : null
  }
  async function snapshotFiles(): Promise<Record<string, string>> {
    let timer: NodeJS.Timeout | undefined
    try {
      const snapshot = await Promise.race([Promise.resolve().then(() => options.snapshotFiles!()), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Error('ERR_CODEX_CHANGE_CHECK')), options.snapshotTimeoutMs ?? 15_000)
      })])
      if (!record(snapshot)) throw Error('ERR_CODEX_CHANGE_CHECK')
      const normalized: Record<string, string> = Object.create(null)
      for (const [path, fingerprint] of Object.entries(snapshot)) {
        if (typeof fingerprint !== 'string') throw Error('ERR_CODEX_CHANGE_CHECK')
        const file = fileWithinRoot(path)
        if (file) normalized[file] = fingerprint
      }
      return normalized
    } finally { if (timer) clearTimeout(timer) }
  }
  function finishTurn(task: CodexTask, turn: Record<string, any>) {
    if (!['completed', 'interrupted', 'failed'].includes(turn.status) || !identifier(turn.id)) return
    if (completion?.task === task && completion.turnId === turn.id) return
    const finishing = { task, turnId: turn.id, flight: Promise.resolve() }
    completion = finishing
    approvals.clear()
    const current = () => state.task === task && task.turnId === turn.id && completion === finishing
    const finalize = () => {
      if (!current()) return
      // A failed process shutdown remains unresolved even if a late file scan finishes.
      if (task.error === 'ERR_CODEX_STOP_UNCONFIRMED' && closing.size) { notify(); return }
      if (turn.status === 'completed') { task.phase = stopIntent ?? 'review'; task.activity = stopIntent ?? 'awaiting-review' }
      else if (turn.status === 'interrupted') { task.phase = stopIntent ?? 'stopped'; task.activity = task.phase }
      else { task.phase = 'failed'; task.error = task.error === 'ERR_CODEX_CHANGE_CHECK' ? task.error : 'ERR_CODEX_TASK_FAILED'; task.activity = text(turn.error?.message, 1000) || 'failed' }
      notify()
    }
    const baseline = fileBaseline?.task === task ? fileBaseline.files : undefined
    if (!options.snapshotFiles || !baseline) finalize()
    else {
      if (task.phase !== 'stopping') task.phase = 'running'
      task.activity = 'checking-changes'; notify()
      finishing.flight = (async () => {
        try {
          const after = await snapshotFiles()
          if (!current()) return
          const changed = new Set(task.changedFiles)
          for (const file of new Set([...Object.keys(baseline), ...Object.keys(after)])) if (baseline[file] !== after[file]) changed.add(file)
          task.changedFiles = [...changed].slice(-200)
          if (changed.size > 200) task.error = 'ERR_CODEX_CHANGE_CHECK'
        } catch { if (current()) task.error = 'ERR_CODEX_CHANGE_CHECK' }
        finalize()
        if (current()) await save().catch(() => { if (current()) { task.error = 'ERR_CODEX_STORAGE'; notify(false) } })
      })()
    }
    // The real terminal event proves the turn stopped. Snapshot completion is
    // awaited separately so a slow local check is not mistaken for a failed interrupt.
    for (const done of terminalWaiters) done()
  }
  function receive(value: unknown) {
    if (!record(value)) throw Error('ERR_CODEX_PROTOCOL')
    if (typeof value.method !== 'string') {
      const entry = pending.get(String(value.id))
      if (!entry) return
      pending.delete(String(value.id)); clearTimeout(entry.timer)
      diagnostic({ event: value.error ? 'rejected' : 'resolved', method: entry.method, requestId: String(value.id), connection: entry.connection })
      if (value.error) entry.reject(Error('ERR_CODEX_PROTOCOL')); else entry.resolve(value.result)
      return
    }
    const params = record(value.params) ? value.params : {}
    if (value.id !== undefined) { serverRequest(value.id, value.method, params); return }
    if (!matches(params)) return
    const task = state.task!
    if (value.method === 'turn/started' && record(params.turn) && identifier(params.turn.id) && !task.turnId) task.turnId = params.turn.id
    if (value.method === 'turn/completed' && record(params.turn) && identifier(params.turn.id) && !task.turnId && turnRequested) {
      if (earlyCompletions.size < 10) earlyCompletions.set(params.turn.id, params.turn)
      return
    }
    if (value.method === 'turn/completed' && record(params.turn) && params.turn.id === task.turnId) {
      finishTurn(task, params.turn); return
    }
    if (completion?.task === task && completion.turnId === task.turnId) return
    if (!codexTaskIsActive(task) || task.phase === 'stopping') return
    if (value.method === 'thread/status/changed' && record(params.status)) {
      if (params.status.type === 'systemError' || params.status.type === 'notLoaded') { task.phase = 'disconnected'; task.error = 'ERR_CODEX_DISCONNECTED' }
      else if (params.status.type === 'active') {
        task.phase = params.status.activeFlags?.includes('waitingOnApproval') ? 'waiting-approval' : params.status.activeFlags?.includes('waitingOnUserInput') ? 'waiting-input' : 'running'
      }
      notify()
    } else if (value.method === 'item/agentMessage/delta' && identifier(params.itemId)) {
      message(params.itemId, 'assistant', text(params.delta), true)
    } else if ((value.method === 'item/started' || value.method === 'item/completed') && record(params.item)) {
      const item = params.item, id = text(item.id, 200) || randomUUID()
      if (item.type === 'agentMessage') message(id, 'assistant', text(item.text))
      else if (item.type === 'commandExecution') { task.activity = value.method === 'item/started' ? 'running-command' : 'command-finished'; message(id, 'command', text(item.command, 4000)) }
      else if (item.type === 'fileChange') {
        if (Array.isArray(item.changes)) fileChanges.set(id, item.changes.filter((change: unknown) => record(change) && typeof change.path === 'string').slice(0, 100)
          .map((change: Record<string, unknown>) => ({ path: text(change.path, 4096), diff: text(change.diff, 20_000) })))
        task.activity = value.method === 'item/started' ? 'editing-files' : 'files-updated'
        if (value.method === 'item/completed' && item.status === 'completed' && Array.isArray(item.changes)) {
          for (const change of item.changes) if (record(change) && typeof change.path === 'string' && change.path.length <= 4096) {
            const file = fileWithinRoot(change.path)
            if (file) task.changedFiles = [...new Set([...task.changedFiles, file])].slice(-200)
          }
          message(id, 'file-change', task.changedFiles.join('\n'))
        }
      } else if (item.type === 'mcpToolCall' || item.type === 'webSearch') task.activity = 'using-tool'
      notify()
    }
  }
  function serverRequest(rpcId: unknown, method: string, params: Record<string, any>) {
    if (!(typeof rpcId === 'string' || typeof rpcId === 'number')) throw Error('ERR_CODEX_PROTOCOL')
    const reject = () => write({ id: rpcId, error: { code: -32601, message: 'MD Duck does not support this request. No approval was granted.' } })
    if (!matches(params) || !codexTaskIsActive(state.task) || state.task?.phase === 'stopping' || completion?.task === state.task) { reject(); return }
    if (method === 'item/permissions/requestApproval') {
      write({ id: rpcId, result: { permissions: {}, scope: 'turn' } })
      message(randomUUID(), 'status', 'Additional permission request was declined. Only the configured workspace permissions remain available.')
      return
    }
    const id = randomUUID()
    let approval: CodexApproval
    if (method === 'item/commandExecution/requestApproval') {
      if (!text(params.command).trim()) {
        write({ id: rpcId, result: { decision: 'decline' } })
        message(randomUUID(), 'status', 'A command request without reviewable command content was declined.')
        return
      }
      approval = { id, kind: 'command', command: text(params.command, 20_000), cwd: text(params.cwd, 4096), reason: text(params.reason, 4000) }
    }
    else if (method === 'item/fileChange/requestApproval') {
      const files = fileChanges.get(text(params.itemId, 200))
      if (!files?.length) {
        write({ id: rpcId, result: { decision: 'decline' } })
        message(randomUUID(), 'status', 'A file change without reviewable file details was declined.')
        return
      }
      approval = { id, kind: 'file-change', reason: text(params.reason, 4000), cwd: text(params.grantRoot, 4096), files }
    }
    else if (method === 'item/tool/requestUserInput' && Array.isArray(params.questions) && params.questions.length <= 10 && params.questions.every((q: unknown) => record(q) && typeof q.id === 'string' && typeof q.question === 'string')) {
      approval = { id, kind: 'question', questions: params.questions.map((q: Record<string, any>) => ({ id: text(q.id, 200), header: text(q.header, 200), question: text(q.question, 8000), isSecret: !!q.isSecret,
        ...(Array.isArray(q.options) ? { options: q.options.slice(0, 30).map((option: Record<string, unknown>) => ({ label: text(option.label, 1000), description: text(option.description, 2000) })) } : {}) })) }
    } else { reject(); message(randomUUID(), 'status', 'An unsupported Codex tool request was rejected; it was not approved.'); return }
    approvals.set(id, { rpcId, method, public: approval })
    state.task!.phase = approval.kind === 'question' ? 'waiting-input' : 'waiting-approval'
    state.task!.activity = state.task!.phase; notify()
  }
  async function check() {
    await initialize()
    if (storageBlocked) return status()
    if (disposed) throw Error('ERR_CODEX_CLOSED')
    if (closing.size) { state.availability = { ...state.availability, state: 'error', message: 'ERR_CODEX_STOP_UNCONFIRMED' }; notify(false); return status() }
    if (busy || codexTaskIsActive(state.task)) return status()
    try { await connect() } catch { /* Availability contains a safe, actionable code. */ }
    if (!busy && !codexTaskIsActive(state.task)) await close().catch(() => { state.availability = { ...state.availability, state: 'error', message: 'ERR_CODEX_STOP_UNCONFIRMED' }; notify(false) })
    return status()
  }
  async function begin(input: CodexTaskInput, continuing: boolean) {
    await initialize()
    if (disposed) throw Error('ERR_CODEX_CLOSED')
    if (busy || codexTaskIsActive(state.task)) throw Error('ERR_CODEX_BUSY')
    if (closing.size) throw Error('ERR_CODEX_STOP_UNCONFIRMED')
    if (storageBlocked) throw Error('ERR_CODEX_STORAGE')
    if (!record(input) || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 20_000) throw Error('ERR_CODEX_TASK_INPUT')
    const article = input.relativePath === undefined ? undefined : normalizeSpaceArticlePath(input.relativePath)
    const prior = state.task
    if (continuing && (!prior?.threadId || !samePath(prior.root, root, platform))) throw Error('ERR_CODEX_RESUME')
    busy = true; stopIntent = undefined; turnRequested = false; approvals.clear()
    fileChanges.clear(); earlyCompletions.clear(); fileBaseline = undefined; completion = undefined
    try {
      const canonical = await fs.realpath(root).catch(() => null)
      if (!canonical || !(await fs.stat(canonical)).isDirectory() || !samePath(canonical, root, platform)) throw Error('ERR_CODEX_ROOT')
      if (article && !await isPathInsideRoot(join(root, article), root)) throw Error('ERR_CODEX_ROOT')
      if (disposed || stopIntent) throw Error('ERR_CODEX_CANCELED')
    } catch (error) { busy = false; throw error }
    state.task = { id: continuing ? prior!.id : randomUUID(), root, ...(continuing ? { threadId: prior!.threadId } : {}), phase: 'starting', prompt: input.prompt.trim(), relativePath: article,
      activity: 'starting', messages: continuing ? prior!.messages : [], changedFiles: [], startedAt: now(), updatedAt: now() }
    notify()
    try {
      await save()
      if (options.snapshotFiles) {
        const task = state.task!
        fileBaseline = { task }
        try { fileBaseline.files = await snapshotFiles() } catch { task.error = 'ERR_CODEX_CHANGE_CHECK'; notify() }
        if (stopIntent || disposed) throw Error('ERR_CODEX_CANCELED')
      }
      await connect()
      if (stopIntent || disposed) throw Error('ERR_CODEX_CANCELED')
      const settings = { cwd: root, sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user',
        developerInstructions: 'This task belongs only to the MD Duck article space at ' + root + '. Keep this task fixed to that directory. Read and edit only the requested article files. Preserve existing Markdown filenames, relative image paths, article.md/article.zh.md companions and block markers. Do not alter .review, .mdduck, application settings, notes or vocabulary data. Do not publish, deploy, send messages, or operate a website. Report changed files and return the result for the user to review.' }
      const opened = await request(continuing ? 'thread/resume' : 'thread/start', { ...settings, ...(continuing ? { threadId: prior!.threadId, excludeTurns: true } : { ephemeral: false }) })
      if (!record(opened) || !record(opened.thread) || !identifier(opened.thread.id) || typeof opened.cwd !== 'string' || !samePath(opened.cwd, root, platform) ||
        opened.sandbox?.type !== 'workspaceWrite' || opened.sandbox.networkAccess === true || opened.approvalPolicy !== 'on-request' || opened.approvalsReviewer !== 'user' ||
        (Array.isArray(opened.sandbox.writableRoots) && opened.sandbox.writableRoots.some((directory: unknown) => typeof directory !== 'string' || !samePath(directory, root, platform)))) throw Error('ERR_CODEX_PROTOCOL')
      if (continuing && (opened.thread.id !== prior!.threadId || opened.thread.status?.type === 'active')) throw Error('ERR_CODEX_RESUME')
      state.task!.threadId = opened.thread.id
      await save()
      if (stopIntent || disposed) throw Error('ERR_CODEX_CANCELED')
      turnRequested = true
      const started = await request('turn/start', { threadId: opened.thread.id, cwd: root, approvalPolicy: 'on-request', approvalsReviewer: 'user',
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: [root], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
        input: [{ type: 'text', text: (article ? `Current article relative to this space: ${article}\n\n` : '') + input.prompt.trim() }] })
      if (!record(started) || !record(started.turn) || !identifier(started.turn.id)) throw Error('ERR_CODEX_PROTOCOL')
      if (state.task!.turnId && state.task!.turnId !== started.turn.id) throw Error('ERR_CODEX_PROTOCOL')
      state.task!.turnId = started.turn.id
      if (state.task!.phase === 'starting') { state.task!.phase = 'running'; state.task!.activity = 'working' }
      const earlyCompletion = earlyCompletions.get(started.turn.id)
      earlyCompletions.clear()
      if (earlyCompletion) receive({ method: 'turn/completed', params: { threadId: opened.thread.id, turn: earlyCompletion } })
      if (started.turn.status !== 'inProgress') receive({ method: 'turn/completed', params: { threadId: opened.thread.id, turn: started.turn } })
      notify(); await save()
      return status()
    } catch (error) {
      if (state.task && state.task.phase !== 'disconnected') {
        state.task.phase = stopIntent ? turnRequested ? 'disconnected' : stopIntent : 'failed'
        state.task.activity = state.task.phase
        if (stopIntent && !turnRequested) delete state.task.error
        else state.task.error = stopIntent ? 'ERR_CODEX_STOP_UNCONFIRMED' : errorCode(error)
      }
      await close().catch(() => { if (state.task) { state.task.phase = 'disconnected'; state.task.error = 'ERR_CODEX_STOP_UNCONFIRMED' } }); notify(); await save().catch(() => undefined)
      return status()
    } finally { busy = false }
  }
  async function respond(response: CodexApprovalResponse) {
    const entry = approvals.get(response.id)
    if (!entry || !child || !codexTaskIsActive(state.task)) throw Error('ERR_CODEX_APPROVAL')
    let result: unknown
    if (entry.public.kind === 'question') {
      if (!record(response.answers)) throw Error('ERR_CODEX_APPROVAL')
      const questions = entry.public.questions ?? [], keys = questions.map(q => q.id)
      if (Object.keys(response.answers).some(key => !keys.includes(key))) throw Error('ERR_CODEX_APPROVAL')
      const answers: Record<string, { answers: string[] }> = {}
      for (const question of questions) {
        const answer = response.answers[question.id]
        if (!Array.isArray(answer) || !answer.length || answer.length > 30 || answer.some(value => typeof value !== 'string' || value.length > 10_000)) throw Error('ERR_CODEX_APPROVAL')
        answers[question.id] = { answers: answer }
      }
      result = { answers }
    } else {
      if (response.decision !== 'approve' && response.decision !== 'decline') throw Error('ERR_CODEX_APPROVAL')
      result = { decision: response.decision === 'approve' ? 'accept' : 'decline' }
    }
    write({ id: entry.rpcId, result }); approvals.delete(response.id)
    state.task!.phase = [...approvals.values()].some(item => item.public.kind === 'question') ? 'waiting-input' : approvals.size ? 'waiting-approval' : 'running'
    state.task!.activity = state.task!.phase; notify()
    return status()
  }
  async function interrupt(intent: 'stopped' | 'taken-over'): Promise<CodexTaskSnapshot> {
    await initialize()
    if (stopFlight) return stopFlight
    stopIntent = intent
    return stopFlight = (async () => {
      const task = state.task
      if (!task) return status()
      if (completion?.task === task && completion.turnId === task.turnId) await completion.flight
      if (!child) {
        if (task.phase === 'disconnected') { await close(); return status() }
        if (!busy) { task.phase = intent; task.activity = intent; notify(); await save().catch(() => undefined); return status() }
      }
      if (codexTaskIsActive(task)) {
        task.phase = 'stopping'; task.activity = 'stopping'; notify()
        if (task.threadId && task.turnId && child) {
          let finish!: () => void
          const ended = new Promise<void>(resolve => { finish = resolve; terminalWaiters.add(resolve) })
          let timer: NodeJS.Timeout | undefined
          try {
            await request('turn/interrupt', { threadId: task.threadId, turnId: task.turnId })
            await Promise.race([ended, new Promise<void>(resolve => { timer = setTimeout(resolve, options.stopTimeoutMs ?? 5000) })])
          } catch { /* Acknowledgement is not proof that execution stopped. */ }
          finally { if (timer) clearTimeout(timer); terminalWaiters.delete(finish) }
          if (completion?.task === task && completion.turnId === task.turnId) await completion.flight
          if (task.phase === 'stopping') { task.phase = 'disconnected'; task.activity = 'disconnected'; task.error = 'ERR_CODEX_STOP_UNCONFIRMED' }
        } else if (!busy) { task.phase = 'disconnected'; task.error = 'ERR_CODEX_STOP_UNCONFIRMED' }
      } else if (task.phase !== 'disconnected') { task.phase = intent; task.activity = intent }
      await close().catch(() => { task.phase = 'disconnected'; task.error = 'ERR_CODEX_STOP_UNCONFIRMED' })
      if (!turnRequested && !child && !closing.size) {
        // No model turn was sent. close() invalidated pending discovery/handshake,
        // and stopIntent blocks the later preflight continuation from sending one.
        // A slow filesystem read or discovery promise is not an executing task.
        task.phase = intent; task.activity = intent; delete task.error
      } else if (busy && !task.turnId) {
        const deadline = Date.now() + (options.stopTimeoutMs ?? 5000)
        while (busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
        if (busy || task.phase === 'stopping') { task.phase = 'disconnected'; task.error = 'ERR_CODEX_STOP_UNCONFIRMED' }
      }
      notify(); await save().catch(() => undefined)
      return status()
    })().finally(() => { stopFlight = undefined })
  }
  function dispose(): Promise<void> {
    if (disposeFlight) return disposeFlight
    disposed = true
    return disposeFlight = (async () => {
      if (codexTaskIsActive(state.task)) await interrupt('stopped')
      await close()
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; await save().catch(() => undefined) }
      await writer.flush().catch(() => undefined)
    })().catch(error => { disposed = false; throw error }).finally(() => { disposeFlight = undefined })
  }
  return { initialize, status, check, start: (input: CodexTaskInput) => begin(input, false), resume: (input: CodexTaskInput) => begin(input, true),
    respond, stop: () => interrupt('stopped'), takeover: () => interrupt('taken-over'), dispose,
    busy: () => busy || codexTaskIsActive(state.task) || closing.size > 0,
    isDisposed: () => disposed }
}

export type CodexRunner = ReturnType<typeof createCodexRunner>
