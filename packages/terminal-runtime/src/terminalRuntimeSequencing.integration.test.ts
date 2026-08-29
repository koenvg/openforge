import { describe, expect, it, vi } from 'vitest'
import { createHost } from './terminalRuntimeHost.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'
import { createTerminalRuntime } from './terminalRuntime'

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
    await runtime.acquire('T-1-shell-0')

    host.emit('pty-model-output-T-1-shell-0', { data: btoa('one'), instance_id: 7, sequence: 1 })
    host.emit('pty-model-output-T-1-shell-0', { data: btoa('stale'), instance_id: 8, sequence: 2 })
    host.emit('pty-model-output-T-1-shell-0', { data: btoa('two'), instance_id: 7, sequence: 2 })

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
  })
})
