import { describe, expect, it } from 'vitest'
import {
  createFakeTerminalView,
  createHost,
} from './terminalRuntime.integrationTestHarness'
import { createTerminalRuntime } from './terminalRuntime'

describe('renderer-neutral terminal view runtime', () => {
  it('replays and renders PTY bytes without allowing a stale instance to mutate a successor view', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    const firstView = createFakeTerminalView()
    const successorView = createFakeTerminalView()
    const views = [firstView, successorView]
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => views.shift() ?? createFakeTerminalView() })

    host.getPtyBuffer = async () => ({ buffer: 'first replay', isLive: true, instanceId: 5 })
    await runtime.acquire(terminalKey)

    expect(firstView.bootstrap).toHaveBeenCalledWith('first replay', 5)
    host.emit(`pty-output-${terminalKey}`, {
      shell_session_key: terminalKey,
      instance_id: 5,
      data: ' first live bytes',
    })
    expect(firstView.writeLive).toHaveBeenCalledWith({
      data: ' first live bytes',
      ptyInstanceId: 5,
    })

    runtime.release(terminalKey)
    host.getPtyBuffer = async () => ({ buffer: 'successor replay', isLive: true, instanceId: 6 })
    await runtime.acquire(terminalKey)

    host.emit(`pty-output-${terminalKey}`, {
      shell_session_key: terminalKey,
      instance_id: 5,
      data: 'stale bytes',
    })
    expect(successorView.writeLive).not.toHaveBeenCalled()

    host.emit(`pty-output-${terminalKey}`, {
      shell_session_key: terminalKey,
      instance_id: 6,
      data: 'successor live bytes',
    })
    expect(successorView.writeLive).toHaveBeenCalledWith({
      data: 'successor live bytes',
      ptyInstanceId: 6,
    })

    runtime.dispose()
  })
})
