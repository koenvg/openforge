import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime } from './terminalRuntime'
import { createHost } from './terminalRuntimeHost.testSupport'
import { resetTerminalRuntimeMocks } from './terminalRuntimeFeatures.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'

function keyHandlerFrom(view: ReturnType<typeof createFakeTerminalView>) {
  return vi.mocked(view.setKeyEventHandler).mock.calls[0]?.[0]
}

describe('agent terminal prompt submit callback', () => {
  beforeEach(resetTerminalRuntimeMocks)

  it('notifies on a plain Enter in a live agent terminal without consuming the key', async () => {
    const onAgentPromptSubmit = vi.fn()
    const view = createFakeTerminalView()
    const host = createHost()
    host.environment.onAgentPromptSubmit = onAgentPromptSubmit
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })

    await runtime.acquire('T-1')
    await runtime.restorePtyInstance('T-1', 7)
    const handler = keyHandlerFrom(view)
    expect(handler).toBeTypeOf('function')

    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    expect(handler!(event)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    await Promise.resolve()

    expect(onAgentPromptSubmit).toHaveBeenCalledExactlyOnceWith('T-1')
    runtime.dispose()
  })

  it('does not notify for Shift+Enter, repeated Enter, or modifier chords', async () => {
    const onAgentPromptSubmit = vi.fn()
    const view = createFakeTerminalView()
    const host = createHost()
    host.environment.onAgentPromptSubmit = onAgentPromptSubmit
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })

    await runtime.acquire('T-2')
    await runtime.restorePtyInstance('T-2', 8)
    const handler = keyHandlerFrom(view)!

    expect(handler(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true }))).toBe(false)
    expect(handler(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, cancelable: true }))).toBe(true)
    expect(handler(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, cancelable: true }))).toBe(true)
    expect(handler(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true }))).toBe(true)
    await Promise.resolve()

    expect(onAgentPromptSubmit).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('does not notify when the PTY is inactive or the session is an indexed shell', async () => {
    const onAgentPromptSubmit = vi.fn()
    const agentView = createFakeTerminalView()
    const shellView = createFakeTerminalView()
    const host = createHost()
    host.environment.onAgentPromptSubmit = onAgentPromptSubmit
    let createCount = 0
    const runtime = createTerminalRuntime({
      ...host,
      createTerminalView: () => {
        createCount += 1
        return createCount === 1 ? agentView : shellView
      },
    })

    await runtime.acquire('T-3')
    const inactiveHandler = keyHandlerFrom(agentView)!
    expect(inactiveHandler(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))).toBe(true)

    await runtime.acquire('T-3-shell-0')
    expect(vi.mocked(shellView.setKeyEventHandler)).not.toHaveBeenCalled()
    await Promise.resolve()

    expect(onAgentPromptSubmit).not.toHaveBeenCalled()
    runtime.dispose()
  })
})
