import { attachTestTerminal, createHost } from './terminalRuntimeHost.testSupport'
import {
  resetTerminalRuntimeMocks,
  terminalMocks,
} from './terminalRuntimeFeatures.testSupport'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime, type TerminalRuntime, type TerminalSession } from './terminalRuntime'

function liveReplay(instanceId: number, data = '') {
  return {
    buffer: null,
    snapshot: { instanceId, watermark: 0, data: btoa(data) },
    isLive: true,
    instanceId,
  }
}
async function completeSpawn(
  runtime: TerminalRuntime,
  session: TerminalSession,
  ptyInstanceId: number,
): Promise<void> {
  const lease = runtime.beginPtySpawn(session)
  expect(lease).not.toBeNull()
  await lease?.started(ptyInstanceId)
  lease?.cancel()
}

describe('terminal runtime tab sessions', () => {
  it('creates, retains, and clears task-scoped shell tab state', () => {
    const runtime = createTerminalRuntime(createHost())
    const initial = runtime.getTaskTerminalTabsSession('T-1')

    expect(initial).toEqual({
      tabs: [{ index: 0, key: 'T-1-shell-0', label: 'Shell 1' }],
      activeTabIndex: 0,
      nextIndex: 1,
    })

    const updated = {
      tabs: [...initial.tabs, { index: 1, key: 'T-1-shell-1', label: 'Shell 2' }],
      activeTabIndex: 1,
      nextIndex: 2,
    }
    runtime.updateTaskTerminalTabsSession('T-1', updated)

    expect(runtime.getTaskTerminalTabsSession('T-1')).toBe(updated)

    runtime.clearTaskTerminalTabsSession('T-1')

    const restored = runtime.getTaskTerminalTabsSession('T-1')
    expect(restored).not.toBe(updated)
    expect(restored.tabs).toEqual([{ index: 0, key: 'T-1-shell-0', label: 'Shell 1' }])
  })
})

describe('terminal runtime PTY activation API', () => {
  it('does not expose direct PTY instance mutation', () => {
    const runtime = createTerminalRuntime(createHost())

    expect(runtime).not.toHaveProperty('setCurrentPtyInstance')
  })
})

describe('terminal runtime resumed agent input', () => {
  beforeEach(resetTerminalRuntimeMocks)

  it('forwards keyboard input after an empty resumed PTY is restored as active', async () => {
    const host = createHost()
    const writePty = vi.spyOn(host, 'writePty')
    const runtime = createTerminalRuntime(host)

    await runtime.restorePtyInstance('T-1', 42)
    await runtime.acquire('T-1')
    expect(runtime.diagnostics.observe('T-1')?.lifecycle.currentPtyInstance).toBe(42)

    const onData = terminalMocks.instances[0].onData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined
    expect(onData).toBeTypeOf('function')
    onData?.('continue')

    expect(writePty).toHaveBeenCalledWith('T-1', 'continue')
  })

  it('preserves Ghostty authority when a resumed instance is restored before acquisition', async () => {
    const host = createHost()
    host.getPtyBuffer = async () => liveReplay(42, 'resumed')
    const runtime = createTerminalRuntime(host)

    await runtime.restorePtyInstance('T-ghostty-agent', 42)
    await runtime.acquire('T-ghostty-agent')

    expect(runtime.diagnostics.observe('T-ghostty-agent')?.lifecycle).toMatchObject({
      currentPtyInstance: 42,
      stateSource: 'ghostty-snapshot',
    })
  })

  it('prefers the live backend instance over stale resumed-agent metadata after restart', async () => {
    const host = createHost()
    host.getPtyBuffer = async () => liveReplay(43, 'restarted')
    const writePty = vi.spyOn(host, 'writePty')
    const runtime = createTerminalRuntime(host)

    await runtime.restorePtyInstance('T-restarted-agent', 42)
    await runtime.acquire('T-restarted-agent')
    const onData = terminalMocks.instances[0].onData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined
    onData?.('continue')

    expect(runtime.diagnostics.observe('T-restarted-agent')?.lifecycle.currentPtyInstance).toBe(43)
    expect(writePty).toHaveBeenCalledWith('T-restarted-agent', 'continue')
  })

  it('resolves Ghostty authority when an acquired agent terminal resumes', async () => {
    const terminalKey = 'T-resumed-ghostty-agent'
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    await runtime.acquire(terminalKey)
    host.getPtyBuffer = async () => liveReplay(43, 'resumed')

    await runtime.restorePtyInstance(terminalKey, 43)

    await vi.waitFor(() => {
      expect(runtime.diagnostics.observe(terminalKey)?.lifecycle.currentPtyInstance).toBe(43)
    })
  })

  it('accepts keyboard input when the backend reports an empty live PTY buffer', async () => {
    const host = createHost()
    host.setBuffer('T-2', '')
    const writePty = vi.spyOn(host, 'writePty')
    const runtime = createTerminalRuntime(host)

    await runtime.acquire('T-2')
    const onData = terminalMocks.instances[0].onData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined
    onData?.('continue')

    expect(runtime.getShellLifecycleState('T-2').ptyActive).toBe(true)
    expect(writePty).toHaveBeenCalledWith('T-2', 'continue')
  })
})

describe('terminal runtime shell output lifecycle', () => {
  beforeEach(resetTerminalRuntimeMocks)

  it('renders historical replay without accepting keyboard input', async () => {
    const host = createHost()
    host.getPtyBuffer = vi.fn(async () => ({
      buffer: 'completed replay',
      isLive: false,
      instanceId: null,
    }))
    const writePty = vi.spyOn(host, 'writePty')
    const runtime = createTerminalRuntime(host)

    const entry = await runtime.acquire('T-1')
    await attachTestTerminal(runtime, entry)
    const onData = terminalMocks.instances[0].onData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined
    onData?.('unsafe input')

    expect(terminalMocks.instances[0].write).toHaveBeenCalledWith(
      'completed replay',
      expect.any(Function),
    )
    expect(runtime.getShellLifecycleState('T-1').ptyActive).toBe(false)
    expect(writePty).not.toHaveBeenCalled()
  })

  it('reports no output for a newly acquired shell without backend buffer', async () => {
    const runtime = createTerminalRuntime(createHost())

    await runtime.acquire('T-1-shell-0')

    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(false)
  })

  it('reports output when a non-empty backend buffer is replayed', async () => {
    const host = createHost()
    host.setBuffer('T-1-shell-0', 'ready prompt')
    const runtime = createTerminalRuntime(host)

    await runtime.acquire('T-1-shell-0')

    expect(runtime.getShellLifecycleState('T-1-shell-0')).toMatchObject({
      ptyActive: true,
      hasOutput: true,
    })
  })

  it('transitions to output observed on current live PTY output and ignores stale output', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire('T-1-shell-0')
    await attachTestTerminal(runtime, entry)
    const lifecycleUpdates: unknown[] = []
    runtime.subscribeShellLifecycle('T-1-shell-0', (state) => lifecycleUpdates.push(state))

    host.getPtyBuffer = async () => liveReplay(7)
    await completeSpawn(runtime, entry, 7)
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(false)

    host.emit('pty-model-output-T-1-shell-0', { data: btoa('stale'), instance_id: 8, sequence: 1 })
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(false)

    host.emit('pty-model-output-T-1-shell-0', { data: btoa('$ '), instance_id: 7, sequence: 1 })

    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(true)
    expect(lifecycleUpdates.at(-1)).toMatchObject({ hasOutput: true, currentPtyInstance: 7 })
  })

  it('changes explicit exit state only for the current PTY instance', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire('T-1-shell-0')

    await completeSpawn(runtime, entry, 7)
    host.emit('pty-exit-T-1-shell-0', { instance_id: 8 })

    expect(runtime.getShellLifecycleState('T-1-shell-0')).toMatchObject({
      ptyActive: true,
      shellExited: false,
    })

    host.emit('pty-exit-T-1-shell-0', { instance_id: 7 })

    expect(runtime.getShellLifecycleState('T-1-shell-0')).toMatchObject({
      ptyActive: false,
      shellExited: true,
    })
  })

  it('defers output from a pending shell spawn until its PTY instance becomes authoritative', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire('T-1-shell-0')

    const lease = runtime.beginPtySpawn(entry)
    expect(lease).not.toBeNull()
    host.emit('pty-model-output-T-1-shell-0', { data: btoa('$ '), instance_id: 1, sequence: 1 })
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(false)

    host.getPtyBuffer = async () => liveReplay(1, 'snapshot')
    await lease?.started(1)
    lease?.cancel()

    expect(runtime.getShellLifecycleState('T-1-shell-0')).toMatchObject({
      ptyActive: true,
      currentPtyInstance: 1,
      hasOutput: true,
    })
  })

  it('resolves a newly spawned Ghostty session before flushing renderer output', async () => {
    const terminalKey = 'T-ghostty-shell-0'
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire(terminalKey)
    await attachTestTerminal(runtime, entry)
    host.getPtyBuffer = async () => liveReplay(9, 'snapshot')

    await completeSpawn(runtime, entry, 9)

    await vi.waitFor(() => {
      expect(runtime.diagnostics.observe(terminalKey)?.lifecycle.currentPtyInstance).toBe(9)
    })
    host.emit(`pty-model-output-${terminalKey}`, {
      instance_id: 9,
      sequence: 1,
      data: btoa('model output'),
    })

    expect(runtime.diagnostics.observe(terminalKey)?.lifecycle.stateSource).toBe('ghostty-snapshot')
    expect(runtime.diagnostics.observe(terminalKey)?.output.modelSequence).toBe(1)
  })

  it('rejects pending output when the completed spawn selects another PTY instance', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire('T-1-shell-0')

    const lease = runtime.beginPtySpawn(entry)
    expect(lease).not.toBeNull()
    host.emit('pty-model-output-T-1-shell-0', { data: btoa('stale'), instance_id: 1, sequence: 1 })
    host.getPtyBuffer = async () => liveReplay(2)
    await lease?.started(2)
    lease?.cancel()

    expect(runtime.getShellLifecycleState('T-1-shell-0')).toMatchObject({
      currentPtyInstance: 2,
      hasOutput: false,
    })
  })

  it('resets output observed when a fresh shell instance starts', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire('T-1-shell-0')
    await attachTestTerminal(runtime, entry)

    host.getPtyBuffer = async () => liveReplay(1)
    await completeSpawn(runtime, entry, 1)
    host.emit('pty-model-output-T-1-shell-0', { data: btoa('$ '), instance_id: 1, sequence: 1 })
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(true)

    host.emit('pty-exit-T-1-shell-0', { instance_id: 1 })
    host.getPtyBuffer = async () => liveReplay(2)
    await completeSpawn(runtime, entry, 2)
    expect(runtime.diagnostics.observe('T-1-shell-0')?.lifecycle.currentPtyInstance).toBe(2)

    expect(runtime.getShellLifecycleState('T-1-shell-0')).toMatchObject({
      ptyActive: true,
      currentPtyInstance: 2,
      hasOutput: false,
    })
  })
})
