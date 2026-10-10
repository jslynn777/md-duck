type StartupPhase = 'idle' | 'starting' | 'ready' | 'failed'

/** Show the reader before loading its profile, credentials, or article library. */
export function createStartup(options: {
  openWindow: () => void | Promise<unknown>
  initialize: () => Promise<void>
}) {
  let phase: StartupPhase = 'idle'
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // Initialization can fail before a renderer has subscribed to this promise.
  void ready.catch(() => undefined)
  let running: Promise<void> | undefined

  function start(): Promise<void> {
    if (running) return running
    phase = 'starting'
    running = (async () => {
      try {
        await options.openWindow()
        await options.initialize()
        phase = 'ready'
        resolveReady()
      } catch {
        phase = 'failed'
        // Do not send raw errors containing paths or credentials to the renderer.
        rejectReady(new Error('ERR_STARTUP'))
      }
    })()
    return running
  }

  return { start, ready: () => ready, phase: () => phase }
}
