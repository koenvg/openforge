import { describe, expect, it } from 'vitest'
import {
  createFakeTerminalView,
  createHost,
} from './terminalRuntime.integrationTestHarness'
import {
  createTerminalRuntime,
  terminalModelOutputEventName,
} from './terminalRuntime'

function encodeBase64(value: string): string {
  return btoa(value)
}

describe('renderer-neutral terminal view runtime', () => {
  it('bootstraps and sequences live output without allowing a stale PTY instance to mutate a successor view', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    const firstView = createFakeTerminalView()
    const successorView = createFakeTerminalView()
    const views = [firstView, successorView]
    const runtime = createTerminalRuntime(host, {
      createTerminalView: () => views.shift() ?? createFakeTerminalView(),
    })

    host.setTerminalViewSnapshot(terminalKey, {
      instanceId: 5,
      watermark: 10,
      data: encodeBase64('first snapshot'),
    })
    await runtime.acquire(terminalKey)

    expect(firstView.bootstrap).toHaveBeenCalledWith(
      Uint8Array.from(new TextEncoder().encode('first snapshot')),
    )

    host.emit(terminalModelOutputEventName(terminalKey), {
      instance_id: 5,
      sequence: 11,
      data: encodeBase64('first live frame'),
    })
    expect(firstView.writeLive).toHaveBeenCalledWith({
      data: Uint8Array.from(new TextEncoder().encode('first live frame')),
      sequence: 11,
    })

    runtime.release(terminalKey)
    host.setTerminalViewSnapshot(terminalKey, {
      instanceId: 6,
      watermark: 20,
      data: encodeBase64('successor snapshot'),
    })
    await runtime.acquire(terminalKey)

    host.emit(terminalModelOutputEventName(terminalKey), {
      instance_id: 5,
      sequence: 12,
      data: encodeBase64('stale frame'),
    })
    expect(successorView.writeLive).not.toHaveBeenCalled()

    host.emit(terminalModelOutputEventName(terminalKey), {
      instance_id: 6,
      sequence: 21,
      data: encodeBase64('successor live frame'),
    })
    expect(successorView.writeLive).toHaveBeenCalledWith({
      data: Uint8Array.from(new TextEncoder().encode('successor live frame')),
      sequence: 21,
    })

    runtime.dispose()
  })
})
