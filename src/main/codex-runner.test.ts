import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCodexRunner, type CodexRunner, type CodexRunnerOptions } from './codex-runner'

type Packet = { id?: string | number; method?: string; params?: any; result?: any; error?: any }
class FakeServer extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new Writable({ write: (chunk, _encoding, done) => { for (const line of chunk.toString().trim().split('\n')) { const packet = JSON.parse(line); this.sent.push(packet); queueMicrotask(() => this.handle(packet)) }; done() } })
  pid = 987654
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  sent: Packet[] = []
  intercept?: (packet: Packet) => boolean
  cwd = ''
  threadId = 'owned-thread'
  turnId = 'owned-turn'
  account: unknown = { account: { type: 'chatgpt', email: 'never-expose@example.test' }, requiresOpenaiAuth: true }
  readiness = 'ready'
  reply(id: string | number | undefined, result: unknown) { this.stdout.write(JSON.stringify({ id, result }) + '\n') }
  event(method: string, params: unknown) { this.stdout.write(JSON.stringify({ method, params }) + '\n') }
  ask(id: string, method: string, params: unknown) { this.stdout.write(JSON.stringify({ id, method, params }) + '\n') }
  handle(packet: Packet) {
    if (this.intercept?.(packet)) return
    const { method, id, params } = packet
    if (method === 'initialize') this.reply(id, { userAgent: 'mock' })
    else if (method === 'account/read') this.reply(id, this.account)
    else if (method === 'windowsSandbox/readiness') this.reply(id, { status: this.readiness })
    else if (method === 'thread/start' || method === 'thread/resume') {
      this.cwd = params.cwd
      this.reply(id, { cwd: this.cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false }, thread: { id: this.threadId, cwd: this.cwd, status: { type: 'idle' } } })
    } else if (method === 'turn/start') {
      this.event('turn/started', { threadId: this.threadId, turn: { id: this.turnId, status: 'inProgress' } })
      this.reply(id, { turn: { id: this.turnId, status: 'inProgress' } })
    } else if (method === 'turn/interrupt') {
      this.reply(id, {})
      this.event('turn/completed', { threadId: this.threadId, turn: { id: this.turnId, status: 'interrupted' } })
    }
  }
  finish() { if (this.exitCode !== null) return; this.exitCode = 0; this.emit('exit', 0, null) }
  kill() { this.finish(); return true }
  child() { return this as unknown as ChildProcessWithoutNullStreams }
}

const directories: string[] = [], runners: CodexRunner[] = []
afterEach(async () => {
  for (const runner of runners.splice(0)) await runner.dispose().catch(() => undefined)
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
async function setup(extra: Partial<CodexRunnerOptions> = {}, configure?: (server: FakeServer) => void) {
  const temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'mdduck-codex-test-')))
  directories.push(temporary)
  const root = join(temporary, '文章 with spaces'), storePath = join(temporary, 'profile', 'task.json')
  await fs.mkdir(root); await fs.writeFile(join(root, 'article.md'), '# Original\n')
  const servers: FakeServer[] = []
  const spawnProcess = vi.fn((_command, _args, options) => { const server = new FakeServer(); server.cwd = options.cwd; configure?.(server); servers.push(server); return server.child() })
  const terminateProcess = vi.fn(async (child: ChildProcessWithoutNullStreams) => { (child as unknown as FakeServer).finish() })
  const options: CodexRunnerOptions = { spaceId: 'space-test', root, storePath, requestTimeoutMs: 100, stopTimeoutMs: 40, discoverExecutable: async () => '/mock/codex', spawnProcess, terminateProcess, ...extra }
  const runner = createCodexRunner(options); runners.push(runner)
  await runner.initialize()
  return { runner, root, storePath, servers, spawnProcess, terminateProcess, options }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 5))

describe('owned Codex stdio tasks', () => {
  it.each(['darwin', 'win32'] as const)('checks login with handshake only and closes its own server, without exposing account data (%s)', async platform => {
    const { runner, servers, spawnProcess, terminateProcess } = await setup({ platform })
    const result = await runner.check()
    expect(result.availability).toMatchObject({ state: 'ready', accountType: 'chatgpt' })
    expect(JSON.stringify(result)).not.toContain('never-expose')
    expect(servers[0].sent.filter(packet => packet.method).map(packet => packet.method)).toEqual([
      'initialize', 'initialized', 'account/read', ...(platform === 'win32' ? ['windowsSandbox/readiness'] : [])
    ])
    expect(servers[0].sent.find(p => p.method === 'account/read')?.params).toEqual({ refreshToken: false })
    expect(spawnProcess.mock.calls[0][1]).toContain('stdio://')
    expect(spawnProcess.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true, detached: platform !== 'win32' })
    expect(terminateProcess).toHaveBeenCalledOnce()
  })

  it('reports missing CLI and login rather than trying a model turn', async () => {
    const missing = await setup({ discoverExecutable: async () => null })
    expect((await missing.runner.check()).availability.state).toBe('not-installed')
    expect(missing.spawnProcess).not.toHaveBeenCalled()
    const loggedOut = await setup({}, server => { server.account = { account: null, requiresOpenaiAuth: true } })
    expect((await loggedOut.runner.check()).availability.state).toBe('not-logged-in')
    expect(loggedOut.servers[0].sent.some(p => p.method === 'turn/start')).toBe(false)
  })

  it('requires prepared Windows sandbox without invoking installation or elevation', async () => {
    const { runner, servers, spawnProcess } = await setup({ platform: 'win32' }, server => { server.readiness = 'notConfigured' })
    expect((await runner.check()).availability).toMatchObject({ state: 'unsupported', message: 'ERR_CODEX_WINDOWS_SANDBOX' })
    expect(servers[0].sent.find(p => p.method === 'windowsSandbox/readiness')?.params).toBeNull()
    expect(servers[0].sent.some(p => p.method === 'windowsSandbox/setupStart' || p.method === 'turn/start')).toBe(false)
    expect(spawnProcess.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true, detached: false })
  })

  it('binds cwd and stdin input, emits real progress, and waits for turn completion before review', async () => {
    const { runner, servers, root, storePath, spawnProcess } = await setup()
    const instruction = 'Review article.md; literal $(echo secret) and `example` are text.'
    expect((await runner.start({ prompt: instruction, relativePath: 'article.md' })).task?.phase).toBe('running')
    const server = servers[0], sent = server.sent.find(p => p.method === 'turn/start')!
    expect(spawnProcess.mock.calls[0][2].cwd).toBe(root)
    expect(spawnProcess.mock.calls[0][1].join(' ')).not.toContain(instruction)
    expect(sent.params).toMatchObject({ threadId: 'owned-thread', cwd: root, sandboxPolicy: { writableRoots: [root], networkAccess: false, excludeSlashTmp: true, excludeTmpdirEnvVar: true } })
    expect(sent.params.input[0].text).toContain(instruction)
    expect(JSON.parse(await fs.readFile(storePath, 'utf8')).task.threadId).toBe('owned-thread')
    server.event('item/agentMessage/delta', { threadId: 'other-thread', turnId: 'owned-turn', itemId: 'ignored', delta: 'foreign' })
    server.event('item/agentMessage/delta', { threadId: 'owned-thread', turnId: 'other-turn', itemId: 'ignored', delta: 'foreign' })
    server.event('item/agentMessage/delta', { threadId: 'owned-thread', turnId: 'owned-turn', itemId: 'answer', delta: 'Read the article.' })
    server.event('thread/status/changed', { threadId: 'owned-thread', status: { type: 'idle' } })
    expect(runner.status().task?.phase).toBe('running')
    expect(runner.status().task?.messages.map(item => item.text)).toEqual(['Read the article.'])
    server.event('turn/completed', { threadId: 'owned-thread', turn: { id: 'other-turn', status: 'completed' } })
    expect(runner.status().task?.phase).toBe('running')
    server.event('turn/completed', { threadId: 'owned-thread', turn: { id: 'owned-turn', status: 'completed' } })
    expect(runner.status().task?.phase).toBe('review')
    expect(await fs.readFile(join(root, 'article.md'), 'utf8')).toBe('# Original\n')
  })

  it('rejects simultaneous starts before asynchronous filesystem preflight', async () => {
    const { runner, servers } = await setup()
    const results = await Promise.allSettled([runner.start({ prompt: 'one' }), runner.start({ prompt: 'two' })])
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(item => item.status === 'rejected')).toHaveLength(1)
    expect(servers).toHaveLength(1)
    expect(servers[0].sent.filter(p => p.method === 'turn/start')).toHaveLength(1)
  })

  it('exposes once-only command approval and refuses unrelated or unsupported requests', async () => {
    const { runner, servers } = await setup()
    await runner.start({ prompt: 'Review the text' })
    const server = servers[0], scope = { threadId: 'owned-thread', turnId: 'owned-turn' }
    server.ask('unrelated', 'item/commandExecution/requestApproval', { ...scope, threadId: 'other', command: 'echo unrelated' })
    expect(runner.status().approvals).toEqual([])
    server.ask('approval-one', 'item/commandExecution/requestApproval', { ...scope, itemId: 'cmd', command: 'inspect file', cwd: server.cwd, reason: 'Needs approval' })
    expect(runner.status().task?.phase).toBe('waiting-approval')
    const approval = runner.status().approvals[0]
    expect(approval).toMatchObject({ kind: 'command', command: 'inspect file', reason: 'Needs approval' })
    await runner.respond({ id: approval.id, decision: 'approve' })
    expect(server.sent.find(p => p.id === 'approval-one' && p.result)?.result).toEqual({ decision: 'accept' })
    await expect(runner.respond({ id: approval.id, decision: 'approve' })).rejects.toThrow('ERR_CODEX_APPROVAL')
    server.ask('permissions', 'item/permissions/requestApproval', scope)
    expect(server.sent.find(p => p.id === 'permissions' && p.result)?.result).toEqual({ permissions: {}, scope: 'turn' })
    server.ask('unsupported', 'item/tool/call', scope)
    expect(server.sent.find(p => p.id === 'unsupported' && p.error)?.error.code).toBe(-32601)
    server.ask('empty-command', 'item/commandExecution/requestApproval', { ...scope, itemId: 'stdin', kind: 'writeStdin', command: null })
    expect(server.sent.find(p => p.id === 'empty-command' && p.result)?.result).toEqual({ decision: 'decline' })
  })

  it('shows file diffs before approval, declines unknown writes, and handles user questions', async () => {
    const { runner, servers } = await setup()
    await runner.start({ prompt: 'Edit article' })
    const server = servers[0], scope = { threadId: 'owned-thread', turnId: 'owned-turn' }
    server.ask('unknown-file', 'item/fileChange/requestApproval', { ...scope, itemId: 'missing' })
    expect(server.sent.find(p => p.id === 'unknown-file' && p.result)?.result).toEqual({ decision: 'decline' })
    server.event('item/started', { ...scope, item: { id: 'patch', type: 'fileChange', changes: [{ path: 'article.md', diff: '- old\n+ new' }] } })
    server.ask('file-approval', 'item/fileChange/requestApproval', { ...scope, itemId: 'patch', reason: 'Review patch' })
    expect(runner.status().approvals[0].files).toEqual([{ path: 'article.md', diff: '- old\n+ new' }])
    await runner.respond({ id: runner.status().approvals[0].id, decision: 'decline' })
    server.ask('question', 'item/tool/requestUserInput', { ...scope, itemId: 'q', questions: [{ id: 'style', header: 'Style', question: 'Which wording?', options: [{ label: 'Brief', description: 'A short passage' }] }] })
    expect(runner.status().task?.phase).toBe('waiting-input')
    await runner.respond({ id: runner.status().approvals[0].id, answers: { style: ['Brief'] } })
    expect(server.sent.find(p => p.id === 'question' && p.result)?.result).toEqual({ answers: { style: { answers: ['Brief'] } } })
  })

  it('takeover waits for its exact turn interrupted event and closes only its owned process', async () => {
    let acknowledge!: () => void
    const { runner, servers, terminateProcess } = await setup({}, server => { server.intercept = p => {
      if (p.method !== 'turn/interrupt') return false
      server.reply(p.id, {}); acknowledge = () => server.event('turn/completed', { threadId: server.threadId, turn: { id: server.turnId, status: 'interrupted' } }); return true
    } })
    await runner.start({ prompt: 'Edit article' })
    const stopping = runner.takeover()
    await settle()
    expect(runner.status().task?.phase).toBe('stopping')
    expect(terminateProcess).not.toHaveBeenCalled()
    acknowledge()
    expect((await stopping).task?.phase).toBe('taken-over')
    expect(servers[0].sent.find(p => p.method === 'turn/interrupt')?.params).toEqual({ threadId: 'owned-thread', turnId: 'owned-turn' })
    expect(terminateProcess).toHaveBeenCalledWith(servers[0].child())
  })

  it('never claims interruption succeeded merely because the interrupt request was acknowledged', async () => {
    const { runner, terminateProcess } = await setup({}, server => { server.intercept = p => { if (p.method !== 'turn/interrupt') return false; server.reply(p.id, {}); return true } })
    await runner.start({ prompt: 'Edit article' })
    const result = await runner.stop()
    expect(result.task).toMatchObject({ phase: 'disconnected', error: 'ERR_CODEX_STOP_UNCONFIRMED' })
    expect(terminateProcess).toHaveBeenCalledOnce()
  })

  it('cancels a starting task without starting a turn and prevents late discovery from spawning after dispose', async () => {
    let discovery!: (path: string | null) => void
    const first = await setup({ discoverExecutable: () => new Promise(resolve => { discovery = resolve }) })
    const starting = first.runner.start({ prompt: 'Will be canceled' })
    while (!discovery) await settle()
    const stopping = first.runner.stop(); discovery('/mock/codex')
    await starting; await stopping
    expect(first.spawnProcess).not.toHaveBeenCalled()
    expect(first.runner.status().task?.phase).toBe('stopped')
    let resolveCheck!: (path: string | null) => void
    const second = await setup({ discoverExecutable: () => new Promise(resolve => { resolveCheck = resolve }) })
    const checking = second.runner.check()
    while (!resolveCheck) await settle()
    await second.runner.dispose(); resolveCheck('/mock/codex'); await checking
    expect(second.spawnProcess).not.toHaveBeenCalled()
  })

  it('confirms a canceled preflight before slow discovery settles without treating it as a running turn', async () => {
    let discovery!: (path: string | null) => void
    const { runner, spawnProcess } = await setup({ stopTimeoutMs: 1, discoverExecutable: () => new Promise(resolve => { discovery = resolve }) })
    const starting = runner.start({ prompt: 'Must never start' })
    while (!discovery) await settle()
    const stopped = await runner.stop()
    expect(stopped.task).toMatchObject({ phase: 'stopped', activity: 'stopped' })
    expect(stopped.task?.error).toBeUndefined()
    expect(spawnProcess).not.toHaveBeenCalled()
    discovery('/mock/codex')
    expect((await starting).task?.phase).toBe('stopped')
    expect(runner.status().task?.error).toBeUndefined()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('preserves unknown stop status and reports disposal failure instead of losing the owned process handle', async () => {
    let fail = true
    const { runner, servers } = await setup({ terminateProcess: async child => { if (fail) throw Error('cannot stop'); (child as unknown as FakeServer).finish() } })
    await runner.start({ prompt: 'Edit article' })
    const result = await runner.stop()
    expect(result.task?.phase).toBe('disconnected')
    expect(servers[0].exitCode).toBeNull()
    await expect(runner.dispose()).rejects.toThrow('cannot stop')
    fail = false
    await runner.dispose()
    expect(servers[0].exitCode).toBe(0)
  })

  it('loads unfinished tasks as disconnected without reconnecting and resumes only with explicit new input', async () => {
    const first = await setup()
    await first.runner.start({ prompt: 'First task' })
    const saved = JSON.parse(await fs.readFile(first.storePath, 'utf8'))
    await first.runner.dispose()
    await fs.writeFile(first.storePath, JSON.stringify(saved))
    const resumed = createCodexRunner(first.options); runners.push(resumed)
    expect((await resumed.initialize()).task?.phase).toBe('disconnected')
    expect(first.servers).toHaveLength(1)
    expect((await resumed.resume({ prompt: 'Continue reviewing the next paragraph' })).task?.phase).toBe('running')
    expect(first.servers[1].sent.find(p => p.method === 'thread/resume')?.params.threadId).toBe('owned-thread')
  })

  it('refuses corrupt task files without overwriting them', async () => {
    const first = await setup()
    await first.runner.dispose()
    await fs.mkdir(join(first.storePath, '..'), { recursive: true })
    const corrupt = '{broken saved task'
    await fs.writeFile(first.storePath, corrupt)
    const runner = createCodexRunner(first.options); runners.push(runner)
    expect((await runner.initialize()).availability).toMatchObject({ state: 'error', message: 'ERR_CODEX_STORAGE' })
    await expect(runner.start({ prompt: 'Must not overwrite' })).rejects.toThrow('ERR_CODEX_STORAGE')
    expect(await fs.readFile(first.storePath, 'utf8')).toBe(corrupt)
    expect(first.spawnProcess).not.toHaveBeenCalled()
  })

  it('retains a completion arriving before the turn/start promise continuation', async () => {
    const { runner } = await setup({}, server => { server.intercept = packet => {
      if (packet.method !== 'turn/start') return false
      server.reply(packet.id, { turn: { id: server.turnId, status: 'inProgress' } })
      server.event('turn/completed', { threadId: server.threadId, turn: { id: server.turnId, status: 'completed' } })
      return true
    } })
    expect((await runner.start({ prompt: 'A fast task' })).task?.phase).toBe('review')
  })

  it('does not permit check or new start to replace a process whose shutdown is unconfirmed', async () => {
    let fail = true
    const context = await setup({ terminateProcess: async child => { if (fail) throw Error('alive'); (child as unknown as FakeServer).finish() } })
    await context.runner.start({ prompt: 'First task' }); await context.runner.stop()
    expect(context.runner.busy()).toBe(true)
    expect((await context.runner.check()).availability.message).toBe('ERR_CODEX_STOP_UNCONFIRMED')
    await expect(context.runner.start({ prompt: 'Second task' })).rejects.toThrow('ERR_CODEX_STOP_UNCONFIRMED')
    expect(context.servers).toHaveLength(1)
    fail = false; await context.runner.stop()
    expect(context.runner.busy()).toBe(false)
    expect(context.servers[0].exitCode).toBe(0)
  })

  it('reuses a check handshake during start without letting check cleanup close the task', async () => {
    let login!: () => void
    const context = await setup({}, server => { server.intercept = packet => {
      if (packet.method !== 'account/read') return false
      login = () => server.reply(packet.id, { account: { type: 'chatgpt' }, requiresOpenaiAuth: true }); return true
    } })
    const checking = context.runner.check()
    while (!login) await settle()
    const starting = context.runner.start({ prompt: 'Start during login check' })
    await settle(); login()
    await checking
    expect((await starting).task?.phase).toBe('running')
    expect(context.servers).toHaveLength(1)
    expect(context.terminateProcess).not.toHaveBeenCalled()
  })

  it('keeps a ready-check connection when start immediately pauses for its baseline scan', async () => {
    let starting: Promise<unknown> | undefined, baseline!: (files: Record<string, string>) => void
    let launchRequested = false
    const context = await setup({
      snapshotFiles: vi.fn().mockImplementationOnce(() => new Promise(resolve => { baseline = resolve })).mockResolvedValue({ 'article.md': 'before' }),
      onChange: state => {
        if (state.availability.state !== 'ready' || launchRequested) return
        launchRequested = true
        starting = context.runner.start({ prompt: 'Start from the ready notification' })
      }
    })
    await Promise.all([context.runner.check(), context.runner.check()])
    await vi.waitFor(() => expect(baseline).toBeDefined())
    expect(context.terminateProcess).not.toHaveBeenCalled()
    baseline({ 'article.md': 'before' })
    await starting
    expect(context.runner.status().task?.phase).toBe('running')
    expect(context.servers).toHaveLength(1)
    expect(context.terminateProcess).not.toHaveBeenCalled()
  })

  it.each(['darwin', 'win32'] as const)('diagnoses the exact timed-out protocol method without exposing parameters or returned data (%s)', async platform => {
    const diagnostic = vi.fn()
    const { runner } = await setup({ platform, onDiagnostic: diagnostic, requestTimeoutMs: 10 }, server => {
      server.intercept = packet => packet.method === 'thread/start'
    })
    expect((await runner.start({ prompt: 'private task text' })).task?.error).toBe('ERR_CODEX_TIMEOUT')
    const events = diagnostic.mock.calls.map(([event]) => event)
    expect(events).toContainEqual({ event: 'request', method: 'initialize', requestId: 'mdduck-1', connection: 1 })
    expect(events).toContainEqual({ event: 'resolved', method: 'account/read', requestId: 'mdduck-2', connection: 1 })
    if (platform === 'win32') expect(events).toContainEqual({ event: 'resolved', method: 'windowsSandbox/readiness', requestId: 'mdduck-3', connection: 1 })
    expect(events).toContainEqual({ event: 'timeout', method: 'thread/start', requestId: platform === 'win32' ? 'mdduck-4' : 'mdduck-3', connection: 1 })
    expect(events.every(event => Object.keys(event).every(key => ['event', 'connection', 'method', 'requestId'].includes(key)))).toBe(true)
    expect(JSON.stringify(events)).not.toMatch(/private task text|never-expose|chatgpt/)
  })

  it('rejects a server that changes the requested workspace before any model turn', async () => {
    const context = await setup({}, server => { server.intercept = packet => {
      if (packet.method !== 'thread/start') return false
      server.reply(packet.id, { cwd: '/unexpected', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'workspaceWrite' }, thread: { id: 'wrong-root' } }); return true
    } })
    expect((await context.runner.start({ prompt: 'Only this space' })).task?.phase).toBe('failed')
    expect(context.servers[0].sent.some(packet => packet.method === 'turn/start')).toBe(false)
  })

  it('checks actual task-period fingerprints after command writes and unions them with file-change events', async () => {
    let finishScan!: (files: Record<string, string>) => void
    const snapshotFiles = vi.fn().mockResolvedValueOnce({ 'article.md': 'before', 'deleted.md': 'old', 'same.md': 'same' })
      .mockImplementationOnce(() => new Promise<Record<string, string>>(resolve => { finishScan = resolve }))
    const { runner, servers } = await setup({ snapshotFiles })
    await runner.start({ prompt: 'Edit with an ordinary command' })
    const server = servers[0], scope = { threadId: server.threadId, turnId: server.turnId }
    server.event('item/completed', { ...scope, item: { id: 'patch', type: 'fileChange', status: 'completed', changes: [{ path: 'reported.md' }] } })
    server.event('item/completed', { ...scope, item: { id: 'command', type: 'commandExecution', command: 'python edits article.md', status: 'completed' } })
    server.event('turn/completed', { threadId: server.threadId, turn: { id: server.turnId, status: 'completed' } })
    expect(runner.status().task).toMatchObject({ phase: 'running', activity: 'checking-changes' })
    server.event('turn/completed', { threadId: server.threadId, turn: { id: server.turnId, status: 'completed' } })
    await vi.waitFor(() => expect(finishScan).toBeDefined())
    finishScan({ 'article.md': 'after', 'new.png': 'new image', 'same.md': 'same', '../foreign.md': 'outside' })
    await vi.waitFor(() => expect(runner.status().task?.phase).toBe('review'))
    expect(runner.status().task?.changedFiles.sort()).toEqual(['article.md', 'deleted.md', 'new.png', 'reported.md'])
    expect(snapshotFiles).toHaveBeenCalledTimes(2)
  })

  it('deduplicates final fingerprints when both the turn response and notification are completed', async () => {
    const snapshotFiles = vi.fn().mockResolvedValueOnce({ 'article.md': 'before' }).mockResolvedValue({ 'article.md': 'after' })
    const { runner } = await setup({ snapshotFiles }, server => { server.intercept = packet => {
      if (packet.method !== 'turn/start') return false
      server.reply(packet.id, { turn: { id: server.turnId, status: 'completed' } })
      server.event('turn/completed', { threadId: server.threadId, turn: { id: server.turnId, status: 'completed' } }); return true
    } })
    await runner.start({ prompt: 'Fast edit' })
    await vi.waitFor(() => expect(runner.status().task?.phase).toBe('review'))
    expect(runner.status().task?.changedFiles).toEqual(['article.md'])
    expect(snapshotFiles).toHaveBeenCalledTimes(2)
  })

  it('collects partial writes after failed turns and after a confirmed interruption', async () => {
    for (const terminal of ['failed', 'interrupted'] as const) {
      const snapshotFiles = vi.fn().mockResolvedValueOnce({ 'article.md': 'before' }).mockResolvedValue({ 'article.md': 'partial' })
      const { runner, servers } = await setup({ snapshotFiles })
      await runner.start({ prompt: 'Partially edit the article' })
      if (terminal === 'interrupted') await runner.takeover()
      else servers[0].event('turn/completed', { threadId: 'owned-thread', turn: { id: 'owned-turn', status: 'failed', error: { message: 'Command failed after writing' } } })
      await vi.waitFor(() => expect(runner.status().task?.phase).toBe(terminal === 'interrupted' ? 'taken-over' : 'failed'))
      expect(runner.status().task?.changedFiles).toEqual(['article.md'])
    }
  })

  it('keeps a real interrupted acknowledgement distinct from a slower final file check', async () => {
    let finishScan!: (files: Record<string, string>) => void
    const snapshotFiles = vi.fn().mockResolvedValueOnce({ 'article.md': 'before' })
      .mockImplementationOnce(() => new Promise<Record<string, string>>(resolve => { finishScan = resolve }))
    const { runner } = await setup({ snapshotFiles, stopTimeoutMs: 5 })
    await runner.start({ prompt: 'Edit article' })
    const stopping = runner.stop()
    await vi.waitFor(() => expect(finishScan).toBeDefined())
    expect(runner.status().task).toMatchObject({ phase: 'stopping', activity: 'checking-changes' })
    finishScan({ 'article.md': 'partially edited' })
    expect((await stopping).task).toMatchObject({ phase: 'stopped', changedFiles: ['article.md'] })
  })

  it('preserves known files when fingerprint checks fail instead of inventing deletions', async () => {
    const snapshotFiles = vi.fn().mockResolvedValueOnce({ 'article.md': 'before', 'untouched.md': 'same' }).mockRejectedValue(Error('ERR_CODEX_SNAPSHOT_LIMIT'))
    const { runner, servers } = await setup({ snapshotFiles })
    await runner.start({ prompt: 'Edit article' })
    servers[0].event('item/completed', { threadId: 'owned-thread', turnId: 'owned-turn', item: { id: 'patch', type: 'fileChange', status: 'completed', changes: [{ path: 'reported.md' }] } })
    servers[0].event('turn/completed', { threadId: 'owned-thread', turn: { id: 'owned-turn', status: 'completed' } })
    await vi.waitFor(() => expect(runner.status().task?.phase).toBe('review'))
    expect(runner.status().task).toMatchObject({ changedFiles: ['reported.md'], error: 'ERR_CODEX_CHANGE_CHECK' })
  })

  it('does not merge a late old snapshot into a newer explicitly started task', async () => {
    let finishOldScan!: (files: Record<string, string>) => void
    const snapshotFiles = vi.fn().mockResolvedValueOnce({ 'old.md': 'old' })
      .mockImplementationOnce(() => new Promise<Record<string, string>>(resolve => { finishOldScan = resolve }))
      .mockResolvedValueOnce({ 'new.md': 'initial' }).mockResolvedValue({ 'new.md': 'changed' })
    const { runner, servers } = await setup({ snapshotFiles })
    await runner.start({ prompt: 'Old task' })
    servers[0].event('turn/completed', { threadId: 'owned-thread', turn: { id: 'owned-turn', status: 'completed' } })
    await vi.waitFor(() => expect(finishOldScan).toBeDefined())
    servers[0].finish()
    expect(runner.status().task?.phase).toBe('disconnected')
    await runner.start({ prompt: 'New explicit task' })
    const newId = runner.status().task!.id
    finishOldScan({ 'old.md': 'changed' }); await settle()
    expect(runner.status().task).toMatchObject({ id: newId, phase: 'running', changedFiles: [] })
    servers[1].event('turn/completed', { threadId: 'owned-thread', turn: { id: 'owned-turn', status: 'completed' } })
    await vi.waitFor(() => expect(runner.status().task?.phase).toBe('review'))
    expect(runner.status().task?.changedFiles).toEqual(['new.md'])
  })
})
