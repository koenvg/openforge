import { describe, expect, it, vi } from 'vitest'
import { createHost } from './terminalRuntimeHost.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'
import { createTerminalRuntime } from './terminalRuntime'

describe('terminal output sequencing', () => {
  it('numbers bootstrap and live output within one PTY generation and restarts the sequence after replacement', async () => {
    const host = createHost()
    host.getPtyBuffer = vi.fn(async () => ({ buffer: 'replay', isLive: true, instanceId: 7 }))
    const view = createFakeTerminalView()
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const entry = await runtime.acquire('T-1-shell-0')

    host.emit('pty-output-T-1-shell-0', { data: 'one', instance_id: 7 })
    host.emit('pty-output-T-1-shell-0', { data: 'stale', instance_id: 8 })
    host.emit('pty-output-T-1-shell-0', { data: 'two', instance_id: 7 })

    expect(view.bootstrap).toHaveBeenCalledWith('replay', 7, 0)
    expect(view.writeLive).toHaveBeenNthCalledWith(1, {
      data: 'one',
      ptyInstanceId: 7,
      sequence: 1,
    })
    expect(view.writeLive).toHaveBeenNthCalledWith(2, {
      data: 'two',
      ptyInstanceId: 7,
      sequence: 2,
    })

    await runtime.markShellPtyStarted(entry, 9)
    host.emit('pty-output-T-1-shell-0', { data: 'replacement', instance_id: 9 })

    expect(view.writeLive).toHaveBeenNthCalledWith(3, {
      data: 'replacement',
      ptyInstanceId: 9,
      sequence: 1,
    })
  })
})
