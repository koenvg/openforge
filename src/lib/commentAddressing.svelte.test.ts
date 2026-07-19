import { flushSync } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { createCommentAddressing } from './commentAddressing.svelte'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe('createCommentAddressing', () => {
  it('locks a pending comment action and contains its rejection for retry', async () => {
    const deferred = createDeferred<void>()
    const duplicateAction = vi.fn()
    let addressing!: ReturnType<typeof createCommentAddressing>
    const cleanup = $effect.root(() => {
      addressing = createCommentAddressing()
    })

    const firstAttempt = addressing.run(42, () => deferred.promise)
    flushSync()

    expect(addressing.isAddressing(42)).toBe(true)
    expect(await addressing.run(42, duplicateAction)).toBe(false)
    expect(duplicateAction).not.toHaveBeenCalled()

    deferred.reject(new Error('request failed'))
    expect(await firstAttempt).toBe(false)
    flushSync()

    expect(addressing.isAddressing(42)).toBe(false)
    expect(addressing.errorFor(42)).toContain('request failed')
    cleanup()
  })
})
