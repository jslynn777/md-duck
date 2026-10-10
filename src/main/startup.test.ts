import { describe, expect, it, vi } from 'vitest'
import { createStartup } from './startup'
import { windowChrome } from './window-options'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('reader startup', () => {
  it('opens a window before slow profile/library initialization and gates IPC readiness', async () => {
    const visible = deferred()
    const initialized = deferred()
    const events: string[] = []
    const startup = createStartup({
      openWindow: () => { events.push('window'); return visible.promise },
      initialize: () => { events.push('initialize'); return initialized.promise }
    })
    const running = startup.start()
    let ready = false
    void startup.ready().then(() => { ready = true })
    expect(events).toEqual(['window'])
    expect(startup.phase()).toBe('starting')
    visible.resolve()
    await Promise.resolve()
    expect(events).toEqual(['window', 'initialize'])
    expect(ready).toBe(false)
    initialized.resolve()
    await running
    await startup.ready()
    expect(ready).toBe(true)
    expect(startup.phase()).toBe('ready')
  })

  it('does not initialize twice when activation arrives during startup', async () => {
    const initialize = vi.fn(async () => {})
    const openWindow = vi.fn(() => {})
    const startup = createStartup({ openWindow, initialize })
    expect(startup.start()).toBe(startup.start())
    await startup.ready()
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(openWindow).toHaveBeenCalledTimes(1)
  })

  it('reports initialization failure to pending and later renderer requests safely', async () => {
    const openWindow = vi.fn(() => {})
    const startup = createStartup({ openWindow, initialize: async () => { throw new Error('private credential') } })
    await startup.start()
    expect(openWindow).toHaveBeenCalled()
    expect(startup.phase()).toBe('failed')
    await expect(startup.ready()).rejects.toThrow('ERR_STARTUP')
    await expect(startup.ready()).rejects.toThrow('ERR_STARTUP')
  })

  it('keeps a failed renderer load from leaving readiness pending forever', async () => {
    const initialize = vi.fn(async () => {})
    const startup = createStartup({ openWindow: async () => { throw new Error('load failed') }, initialize })
    await startup.start()
    await expect(startup.ready()).rejects.toThrow('ERR_STARTUP')
    expect(initialize).not.toHaveBeenCalled()
  })
})

describe('native title bars', () => {
  it('uses native Windows and Linux controls without macOS traffic lights', () => {
    expect(windowChrome('win32')).toEqual({ titleBarStyle: 'default' })
    expect(windowChrome('linux')).toEqual({ titleBarStyle: 'default' })
    expect(windowChrome('darwin')).toEqual({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } })
  })
})
