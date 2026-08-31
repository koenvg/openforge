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

  it('can hold acquisition after the runtime entry exists and is inert without a hook', async () => {
    const runtime = createTerminalRuntime({ ...createHost(), createTerminalView: createFakeTerminalView })
    let releaseCheckpoint!: () => void
    const afterAcquire = vi.fn(() => new Promise<void>(resolve => { releaseCheckpoint = resolve }))
    const service = createTerminalSessionService(runtime, { afterAcquire })
    const client = service.createClient('agent')

    let returned = false
    const acquisition = client.acquire('T-gated-shell-0').then((entry) => {
      returned = true
      return entry
    })
    await vi.waitFor(() => expect(afterAcquire).toHaveBeenCalledOnce())

    expect(runtime._getPool().has('T-gated-shell-0')).toBe(true)
    expect(returned).toBe(false)

    releaseCheckpoint()
    await expect(acquisition).resolves.toBe(runtime._getPool().get('T-gated-shell-0'))

    const ungatedService = createTerminalSessionService(runtime)
    await expect(ungatedService.createClient('terminal-plugin').acquire('T-ungated-shell-0')).resolves.toBeDefined()
  })
})
