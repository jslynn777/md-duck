import { useEffect, useRef, useState } from 'react'
import type { CodexApprovalResponse, CodexTaskInput, CodexTaskSnapshot } from '../../shared/codex-task'
type Action = 'check' | 'submit' | 'stop' | 'takeover' | 'respond'

export function codexRootsMatch(first: string, second: string): boolean {
  const normalize = (root: string) => {
    const value = root.replaceAll('\\', '/').replace(/\/$/, '')
    return /^[a-z]:\//i.test(value) || value.startsWith('//') ? value.toLowerCase() : value
  }
  return normalize(first) === normalize(second)
}

export function useCodexTasks(spaceId?: string | null, root?: string | null) {
  const [snapshots, setSnapshots] = useState<Record<string, CodexTaskSnapshot>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<Record<string, Action[]>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const latestSpace = useRef(spaceId), cache = useRef(snapshots), pending = useRef(new Map<string, Set<Action>>())
  const latestRoot = useRef(root)
  const versions = useRef(new Map<string, number>())
  latestSpace.current = spaceId
  latestRoot.current = root
  cache.current = snapshots
  function accept(snapshot: CodexTaskSnapshot) {
    if (snapshot.spaceId === latestSpace.current && latestRoot.current && !codexRootsMatch(snapshot.root, latestRoot.current)) return
    cache.current = { ...cache.current, [snapshot.spaceId]: snapshot }
    setSnapshots(cache.current)
  }
  useEffect(() => window.api.onCodexTask(snapshot => {
    versions.current.set(snapshot.spaceId, (versions.current.get(snapshot.spaceId) ?? 0) + 1)
    accept(snapshot)
  }), [])
  useEffect(() => {
    if (!spaceId) return
    let live = true
    const version = versions.current.get(spaceId) ?? 0
    setLoading(current => ({ ...current, [spaceId]: true }))
    setErrors(current => ({ ...current, [spaceId]: '' }))
    void window.api.getCodexTask(spaceId).then(snapshot => {
      if (live && snapshot.spaceId === spaceId && version === (versions.current.get(spaceId) ?? 0)) accept(snapshot)
    }).catch(reason => { if (live) setErrors(current => ({ ...current, [spaceId]: String(reason instanceof Error ? reason.message : reason) })) })
      .finally(() => { if (live) setLoading(current => ({ ...current, [spaceId]: false })) })
    return () => { live = false }
  }, [spaceId, root])

  async function run(kind: Action, action: (id: string) => Promise<CodexTaskSnapshot>) {
    const id = spaceId
    if (!id || latestSpace.current !== id) throw new Error('ERR_CODEX_SPACE_CHANGED')
    const actions = pending.current.get(id) ?? new Set<Action>()
    if (actions.has(kind) || (kind !== 'check' && (actions.has('stop') || actions.has('takeover'))) || (kind === 'submit' && actions.size > 0)) throw new Error('ERR_CODEX_BUSY')
    const version = versions.current.get(id) ?? 0
    actions.add(kind)
    pending.current.set(id, actions)
    setBusy(current => ({ ...current, [id]: [...actions] }))
    setErrors(current => ({ ...current, [id]: '' }))
    try {
      const snapshot = await action(id)
      // A late response can update its own cached space, never the one now on screen.
      // Streaming notifications already received take precedence over an older RPC reply.
      if (snapshot.spaceId === id && version === (versions.current.get(id) ?? 0)) accept(snapshot)
    } catch (reason) {
      setErrors(current => ({ ...current, [id]: String(reason instanceof Error ? reason.message : reason) }))
      throw reason
    } finally {
      actions.delete(kind)
      setBusy(current => ({ ...current, [id]: [...actions] }))
    }
  }
  return {
    snapshots,
    snapshot: spaceId && snapshots[spaceId] && (!root || codexRootsMatch(snapshots[spaceId].root, root)) ? snapshots[spaceId] : null,
    loading: !!spaceId && !!loading[spaceId],
    checking: !!spaceId && !!busy[spaceId]?.includes('check'),
    busy: !!spaceId && !!busy[spaceId]?.length,
    controlBusy: !!spaceId && !!busy[spaceId]?.some(action => action === 'stop' || action === 'takeover'),
    replyBusy: !!spaceId && !!busy[spaceId]?.some(action => action === 'stop' || action === 'takeover' || action === 'respond'),
    error: spaceId ? errors[spaceId] ?? '' : '',
    check: () => run('check', id => window.api.checkCodex(id)),
    start: (input: CodexTaskInput) => run('submit', id => {
      const previous = cache.current[id]
      return previous?.task?.threadId && codexRootsMatch(previous.task.root, latestRoot.current ?? previous.root)
        ? window.api.resumeCodexTask(id, input) : window.api.startCodexTask(id, input)
    }),
    stop: () => run('stop', id => window.api.stopCodexTask(id)),
    takeover: () => run('takeover', id => window.api.takeoverCodexTask(id)),
    respond: (response: CodexApprovalResponse) => run('respond', id => window.api.respondCodexApproval(id, response))
  }
}
