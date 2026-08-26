import { describe, expect, it, vi } from 'vitest'
import { createHost } from './terminalRuntimeHost.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'
import { createTerminalRuntime } from './terminalRuntime'
import { createTerminalSessionService } from './terminalSessionService'

describe('host-owned terminal session service', () => {
  it('shares one Terminal Session across concurrent clients and disposes it after the last owner releases it', async () => {
    const view = createFakeTerminalView()
    const runtime = createTerminalRuntime({ ...createHost(), createTerminalView: () => view })
    const service = createTerminalSessionService(runtime)
    const agent = service.createClient('agent')
    const regularTerminal = service.createClient('terminal-plugin')

    const [agentEntry, regularEntry] = await Promise.all([
      agent.acquire('T-1-shell-0'),
      regularTerminal.acquire('T-1-shell-0'),
    ])

    expect(regularEntry).toBe(agentEntry)
    expect(runtime._getPool().size).toBe(1)

    agent.release('T-1-shell-0')
    expect(runtime._getPool().size).toBe(1)
    expect(view.dispose).not.toHaveBeenCalled()

    regularTerminal.release('T-1-shell-0')
    expect(runtime._getPool().size).toBe(0)
    expect(view.dispose).toHaveBeenCalledOnce()
  })

  it('limits bulk release to the calling client', async () => {
    const views = [createFakeTerminalView(), createFakeTerminalView()]
    const runtime = createTerminalRuntime({ ...createHost(), createTerminalView: vi.fn(() => views.shift() ?? createFakeTerminalView()), })
    const service = createTerminalSessionService(runtime)
    const agent = service.createClient('agent')
    const regularTerminal = service.createClient('terminal-plugin')

    await agent.acquire('T-1')
    await regularTerminal.acquire('T-1-shell-0')

    agent.releaseAll()

    expect(runtime.hasTerminal('T-1')).toBe(false)
    expect(runtime.hasTerminal('T-1-shell-0')).toBe(true)
  })
})
