import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime, type TerminalViewRendererFailure } from './terminalRuntime'
import { attachTestTerminal, createHost } from './terminalRuntimeHost.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'


afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('asynchronous renderer readiness and loss', () => {
  it('waits for native geometry before the first fit', async () => {
    const host = createHost()
    const order: string[] = []
    const view = createFakeTerminalView({
      prepare: async () => { await Promise.resolve(); order.push('prepared') },
      fit: () => { order.push('fit'); return { cols: 90, rows: 30 } },
    })
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const session = await runtime.acquire('T-1-shell-0')
    try {
      await attachTestTerminal(runtime, session)
      expect(order.slice(0, 2)).toEqual(['prepared', 'fit'])
    } finally { runtime.release('T-1-shell-0') }
  })

  it('recovers from the existing authority when a renderer loses parsed state', async () => {
    const host = createHost()
    let fail: (failure: TerminalViewRendererFailure) => void = () => {}
    const snapshots: string[] = []
    const view = createFakeTerminalView({
      onRendererFailure: listener => { fail = listener; return { dispose() {} } },
      replaceSnapshot: async snapshot => { snapshots.push(typeof snapshot.data === 'string' ? snapshot.data : new TextDecoder().decode(snapshot.data)) },
    })
    host.setBuffer('T-1-shell-0', 'BEFORE')
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const session = await runtime.acquire('T-1-shell-0')
    try {
      await attachTestTerminal(runtime, session)
      host.setBuffer('T-1-shell-0', 'AFTER')
      fail({ renderer: 'native-test', reason: 'context-lost', requiresRecovery: true })
      await vi.waitFor(() => expect(snapshots.at(-1)).toContain('AFTER'))
    } finally { runtime.release('T-1-shell-0') }
  })
})
