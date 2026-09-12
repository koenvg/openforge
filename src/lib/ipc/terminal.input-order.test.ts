import { afterEach, describe, expect, it, vi } from 'vitest'
import { writePty } from './terminal'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

afterEach(() => { delete window.openforge })

describe('terminal input ordering', () => {
  it('delivers rapid same-shell input in order even when the bridge delays the first write', async () => {
    const first = deferred()
    let received = ''
    window.openforge = {
      version: 1,
      onEvent: () => () => {},
      async invoke(_command, payload) {
        const { data } = payload as { data: string }
        if (data === 'a') await first.promise
        received += data
      },
    }
    const writes = [...'after4'].map(data => writePty('T-1-shell-0', data))
    await Promise.resolve()
    first.resolve()
    await Promise.all(writes)
    expect(received).toBe('after4')
  })

  it('does not block another shell behind a slow write', async () => {
    const first = deferred()
    const received: string[] = []
    window.openforge = {
      version: 1,
      onEvent: () => () => {},
      async invoke(_command, payload) {
        const { shellSessionKey, data } = payload as { shellSessionKey: string; data: string }
        if (shellSessionKey === 'T-1-shell-0') await first.promise
        received.push(data)
      },
    }
    const slow = writePty('T-1-shell-0', 'slow')
    const independent = writePty('T-1-shell-1', 'independent')
    try {
      await vi.waitFor(() => expect(received).toEqual(['independent']))
    } finally {
      first.resolve()
      await Promise.all([slow, independent])
    }
    expect(received).toEqual(['independent', 'slow'])
  })

  it('reports failed writes without retrying them or blocking later input', async () => {
    const first = deferred()
    const failure = new Error('write outcome unknown')
    const attempted: string[] = []
    let received = ''
    window.openforge = {
      version: 1,
      onEvent: () => () => {},
      async invoke(_command, payload) {
        const { data } = payload as { data: string }
        attempted.push(data)
        if (data === 'a') await first.promise
        received += data
      },
    }
    const failed = expect(writePty('T-1-shell-0', 'a')).rejects.toBe(failure)
    const next = writePty('T-1-shell-0', 'b')
    first.reject(failure)
    await Promise.all([failed, next])
    await writePty('T-1-shell-0', 'c')
    expect(received).toBe('bc')
    expect(attempted).toEqual(['a', 'b', 'c'])
  })

  it('keeps queued input fenced to the original terminal after a restart', async () => {
    const first = deferred()
    const fence = {
      controller: { installation: 'install', lifetime: 'controller', generation: 1 },
      instanceId: 1,
    }
    const stale = new Error('stale terminal identity')
    let received = ''
    window.openforge = {
      version: 1,
      onEvent: () => () => {},
      async invoke(_command, payload) {
        const request = payload as { data: string; fence: typeof fence }
        if (request.data === 'a') await first.promise
        else if (request.fence.instanceId !== 2 || request.fence.controller.generation !== 2) throw stale
        received += request.data
      },
    }
    const started = writePty('T-1-shell-0', 'a', fence)
    const queued = expect(writePty('T-1-shell-0', 'b', fence)).rejects.toBe(stale)
    fence.instanceId = 2
    fence.controller.generation = 2
    first.resolve()
    await Promise.all([started, queued])
    await writePty('T-1-shell-0', 'c', fence)
    expect(received).toBe('ac')
  })
})
