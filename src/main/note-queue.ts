export function createNoteQueue() {
  const tails = new Map<string, Promise<void>>()

  return function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const result = (tails.get(key) ?? Promise.resolve()).then(task)
    const release = () => {
      if (tails.get(key) === tail) tails.delete(key)
    }
    // Both handlers resolve the internal tail, so a failed transaction does not
    // block later work or leave a separate rejected cleanup promise behind.
    const tail = result.then(release, release)
    tails.set(key, tail)
    return result
  }
}
