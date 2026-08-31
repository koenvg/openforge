import { describe, expect, it, vi } from 'vitest'
import { attachTestTerminal, createHost } from './terminalRuntimeHost.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'
import { createTerminalRuntime } from './terminalRuntime'
import { createTerminalPerformanceTrace } from './terminalPerformanceTrace'

describe('terminal output sequencing', () => {
  it('renders contiguous model output and ignores stale PTY instances', async () => {
    const host = createHost()
    host.getPtyBuffer = vi.fn(async () => ({
      buffer: null,
      isLive: true,
      instanceId: 7,
      snapshot: { instanceId: 7, watermark: 0, data: btoa('snapshot') },
    }))
    const view = createFakeTerminalView()
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const entry = await runtime.acquire('T-1-shell-0')
    await attachTestTerminal(runtime, entry)

    host.emit('pty-model-output-T-1-shell-0', { data: btoa('one'), instance_id: 7, sequence: 1 })
    host.emit('pty-model-output-T-1-shell-0', { data: btoa('stale'), instance_id: 8, sequence: 2 })
    host.emit('pty-model-output-T-1-shell-0', { data: btoa('two'), instance_id: 7, sequence: 2 })
    host.emit('pty-model-output-T-1-shell-0', {
      data: btoa('three four'),
      instance_id: 7,
      start_sequence: 3,
      sequence: 4,
    })

    expect(view.writeLive).toHaveBeenNthCalledWith(1, {
      data: Uint8Array.from(new TextEncoder().encode('one')),
      ptyInstanceId: 7,
      sequence: 1,
    })
    expect(view.writeLive).toHaveBeenNthCalledWith(2, {
      data: Uint8Array.from(new TextEncoder().encode('two')),
      ptyInstanceId: 7,
      sequence: 2,
    })
    expect(view.writeLive).toHaveBeenNthCalledWith(3, {
      data: Uint8Array.from(new TextEncoder().encode('three four')),
      ptyInstanceId: 7,
      sequence: 3,
    })
    expect(runtime.diagnostics.observe('T-1-shell-0')?.output).toMatchObject({
      modelSequence: 4,
      ptyInstanceId: 7,
      receivedBytes: 16,
      firstSequence: 1,
      lastSequence: 4,
      sequenceContinuous: true,
    })
  })

  it('arms output phases on accepted input and ignores prompt and stale-instance output', async () => {
    let timestamp = 1
    const performanceTrace = createTerminalPerformanceTrace({ now: () => timestamp++ })
    performanceTrace.start()
    performanceTrace.mark('terminalAttachment', { terminalKey: 'T-1-shell-0' })
    performanceTrace.mark('xtermMount', { terminalKey: 'T-1-shell-0' })
    performanceTrace.mark('shellSpawnRequest', { terminalKey: 'T-1-shell-0' })
    performanceTrace.mark('ptyCreation', { terminalKey: 'T-1-shell-0', ptyInstanceId: 7 })

    const host = createHost()
    host.getPtyBuffer = vi.fn(async () => ({
      buffer: null,
      isLive: true,
      instanceId: 7,
      snapshot: { instanceId: 7, watermark: 0, data: btoa('snapshot') },
    }))
    const inputListeners: Array<(data: string) => void> = []
    const view = createFakeTerminalView({
      onUserInput: vi.fn((listener: (data: string) => void) => {
        inputListeners.push(listener)
        return { dispose: vi.fn() }
      }),
    })
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    host.environment.performanceTrace = performanceTrace
    const entry = await runtime.acquire('T-1-shell-0')
    await attachTestTerminal(runtime, entry)

    host.emit('pty-model-output-T-1-shell-0', { data: btoa('prompt'), instance_id: 7, sequence: 1 })
    host.emit('pty-model-output-T-1-shell-0', { data: btoa('stale'), instance_id: 8, sequence: 2 })
    expect(performanceTrace.snapshot()?.timestamps.firstOutput).toBeUndefined()

    inputListeners[0]?.('printf ready')
    host.emit('pty-model-output-T-1-shell-0', { data: btoa('ready'), instance_id: 7, sequence: 2 })

    expect(performanceTrace.snapshot()?.timestamps).toMatchObject({
      inputAcceptance: 6,
      firstOutput: 7,
      modelPublication: 8,
    })
    expect(host.transport.writeUserInput).toHaveBeenCalledWith('T-1-shell-0', 'printf ready')
  })
})
