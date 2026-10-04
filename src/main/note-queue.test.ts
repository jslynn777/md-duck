import { describe, expect, it } from 'vitest'
import { createNoteQueue } from './note-queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('note transaction queue', () => {
  it('serializes the entire transaction so later edits read the latest saved state', async () => {
    const enqueue = createNoteQueue()
    const firstStarted = deferred<void>()
    const saveAllowed = deferred<void>()
    const events: string[] = []
    let saved = ['original']

    const first = enqueue('/docs/a.notes.json', async () => {
      events.push('first read')
      const updated = [...saved, 'first']
      firstStarted.resolve()
      await saveAllowed.promise
      saved = updated
      events.push('first saved')
      return 'first result'
    })
    const second = enqueue('/docs/a.notes.json', async () => {
      events.push('second read')
      saved = [...saved, 'second']
      events.push('second saved')
      return 2
    })
    const third = enqueue('/docs/a.notes.json', async () => {
      events.push('third read')
      saved = [...saved, 'third']
    })

    await firstStarted.promise
    expect(events).toEqual(['first read'])
    expect(saved).toEqual(['original'])

    saveAllowed.resolve()
    expect(await first).toBe('first result')
    expect(await second).toBe(2)
    await third
    expect(events).toEqual(['first read', 'first saved', 'second read', 'second saved', 'third read'])
    expect(saved).toEqual(['original', 'first', 'second', 'third'])

    // The same path remains usable after all previous transactions finish.
    expect(await enqueue('/docs/a.notes.json', async () => saved.length)).toBe(4)
  })

  it('returns the original failure and still runs the next transaction', async () => {
    const enqueue = createNoteQueue()
    const firstStarted = deferred<void>()
    const saveAttempt = deferred<void>()
    const events: string[] = []
    const failure = new Error('Write failed')

    const first = enqueue('/docs/a.notes.json', async () => {
      events.push('first started')
      firstStarted.resolve()
      await saveAttempt.promise
    })
    const firstRejected = expect(first).rejects.toBe(failure)
    const second = enqueue('/docs/a.notes.json', async () => {
      events.push('second saved')
      return 'saved'
    })

    await firstStarted.promise
    expect(events).toEqual(['first started'])
    saveAttempt.reject(failure)

    await firstRejected
    expect(await second).toBe('saved')
    expect(events).toEqual(['first started', 'second saved'])
  })

  it('allows unrelated note files to save while another file is waiting', async () => {
    const enqueue = createNoteQueue()
    const firstStarted = deferred<void>()
    const firstSaveAllowed = deferred<void>()
    const secondStarted = deferred<void>()
    const events: string[] = []

    const first = enqueue('/docs/a.notes.json', async () => {
      events.push('a started')
      firstStarted.resolve()
      await firstSaveAllowed.promise
      events.push('a saved')
    })
    const second = enqueue('/docs/b.notes.json', async () => {
      events.push('b started')
      secondStarted.resolve()
      events.push('b saved')
      return 'b result'
    })

    await Promise.all([firstStarted.promise, secondStarted.promise])
    expect(await second).toBe('b result')
    expect(events).toEqual(['a started', 'b started', 'b saved'])

    firstSaveAllowed.resolve()
    await first
    expect(events).toEqual(['a started', 'b started', 'b saved', 'a saved'])
  })
})
