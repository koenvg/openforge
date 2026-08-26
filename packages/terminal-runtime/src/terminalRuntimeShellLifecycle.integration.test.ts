import {
  createHost,
  resetTerminalRuntimeIntegrationHarness,
  terminalMocks,
} from './terminalRuntime.integrationTestHarness'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime } from './terminalRuntime'

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
  beforeEach(resetTerminalRuntimeIntegrationHarness)

  it('forwards keyboard input after an empty resumed PTY is restored as active', async () => {
    const host = createHost()
    const writePty = vi.spyOn(host, 'writePty')
    const runtime = createTerminalRuntime(host)

    await runtime.restorePtyInstance('T-1', 42)
    const entry = await runtime.acquire('T-1')
    expect(entry.authority).toMatchObject({
      shellSessionKey: 'T-1',
      ptyInstanceId: 42,
    })

    const onData = terminalMocks.instances[0].onData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined
    expect(onData).toBeTypeOf('function')
    onData?.('continue')

    expect(writePty).toHaveBeenCalledWith('T-1', 'continue')
  })

  it('preserves Ghostty authority when a resumed instance is restored before acquisition', async () => {
    const host = createHost()
    host.getPtyBuffer = async () => ({
      authority: 'ghostty-authoritative',
      buffer: null,
      snapshot: { instanceId: 42, watermark: 0, data: btoa('resumed') },
      isLive: true,
      instanceId: 42,
    })
    const runtime = createTerminalRuntime(host)

    await runtime.restorePtyInstance('T-ghostty-agent', 42)
    const entry = await runtime.acquire('T-ghostty-agent')

    expect(entry.authority?.contract.mode).toBe('ghostty-authoritative')
    expect(entry.terminalStateSource).toBe('ghostty-snapshot')
  })

  it('prefers the live backend instance over stale resumed-agent metadata after restart', async () => {
    const host = createHost()
    host.getPtyBuffer = async () => ({
      authority: 'ghostty-authoritative',
      buffer: null,
      snapshot: { instanceId: 43, watermark: 0, data: btoa('restarted') },
      isLive: true,
      instanceId: 43,
    })
    const writePty = vi.spyOn(host, 'writePty')
    const runtime = createTerminalRuntime(host)

    await runtime.restorePtyInstance('T-restarted-agent', 42)
    const entry = await runtime.acquire('T-restarted-agent')
    const onData = terminalMocks.instances[0].onData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined
    onData?.('continue')

    expect(entry.currentPtyInstance).toBe(43)
    expect(entry.authority).toMatchObject({
      ptyInstanceId: 43,
      contract: { mode: 'ghostty-authoritative' },
    })
    expect(writePty).toHaveBeenCalledWith('T-restarted-agent', 'continue')
  })

  it('resolves Ghostty authority when an acquired agent terminal resumes', async () => {
    const terminalKey = 'T-resumed-ghostty-agent'
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire(terminalKey)
    host.getPtyBuffer = async () => ({
      authority: 'ghostty-authoritative',
      buffer: null,
      snapshot: { instanceId: 43, watermark: 0, data: btoa('resumed') },
      isLive: true,
      instanceId: 43,
    })

    await runtime.restorePtyInstance(terminalKey, 43)

    await vi.waitFor(() => {
      expect(entry.authority?.contract.mode).toBe('ghostty-authoritative')
    })
  })

  it('accepts keyboard input when the backend reports an empty live PTY buffer', async () => {
    const host = createHost()
    host.setBuffer('T-2', '')
    const writePty = vi.spyOn(host, 'writePty')
    const runtime = createTerminalRuntime(host)

    const entry = await runtime.acquire('T-2')
    const onData = terminalMocks.instances[0].onData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined
    onData?.('continue')

    expect(entry.ptyActive).toBe(true)
    expect(writePty).toHaveBeenCalledWith('T-2', 'continue')
  })
})

describe('terminal runtime shell output lifecycle', () => {
  beforeEach(resetTerminalRuntimeIntegrationHarness)

  it('renders a persisted Terminal Replay without accepting keyboard input', async () => {
    const host = createHost()
    host.getPtyBuffer = vi.fn(async () => ({
      buffer: 'completed replay',
      isLive: false,
      instanceId: null,
    }))
    const writePty = vi.spyOn(host, 'writePty')
    const runtime = createTerminalRuntime(host)

    const entry = await runtime.acquire('T-1')
    const onData = terminalMocks.instances[0].onData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined
    onData?.('unsafe input')

    expect(terminalMocks.instances[0].write).toHaveBeenCalledWith('completed replay', expect.any(Function))
    expect(entry.ptyActive).toBe(false)
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
    const lifecycleUpdates: unknown[] = []
    runtime.subscribeShellLifecycle('T-1-shell-0', (state) => lifecycleUpdates.push(state))

    await runtime.markShellPtyStarted(entry, 7)
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(false)

    host.emit('pty-output-T-1-shell-0', { data: 'stale', instance_id: 8 })
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(false)

    host.emit('pty-output-T-1-shell-0', { data: '$ ', instance_id: 7 })

    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(true)
    expect(lifecycleUpdates.at(-1)).toMatchObject({ hasOutput: true, currentPtyInstance: 7 })
  })

  it('defers output from a pending shell spawn until its PTY instance becomes authoritative', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire('T-1-shell-0')

    runtime.markPtySpawnPending(entry)
    host.emit('pty-output-T-1-shell-0', { data: '$ ', instance_id: 1 })
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(false)

    await runtime.markShellPtyStarted(entry, 1)

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
    host.getPtyBuffer = async () => ({
      authority: 'ghostty-authoritative',
      buffer: null,
      snapshot: { instanceId: 9, watermark: 0, data: btoa('snapshot') },
      isLive: true,
      instanceId: 9,
    })

    runtime.markPtySpawnPending(entry)
    host.emit(`pty-output-${terminalKey}`, { data: 'raw output', instance_id: 9 })
    await runtime.markShellPtyStarted(entry, 9)

    await vi.waitFor(() => {
      expect(entry.authority?.contract.mode).toBe('ghostty-authoritative')
    })
    host.emit(`pty-model-output-${terminalKey}`, {
      instance_id: 9,
      sequence: 1,
      data: btoa('model output'),
    })

    expect(entry.terminalStateSource).toBe('ghostty-snapshot')
    expect(entry.terminalModelSequence).toBe(1)
  })

  it('rejects pending output when the completed spawn selects another PTY instance', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire('T-1-shell-0')

    runtime.markPtySpawnPending(entry)
    host.emit('pty-output-T-1-shell-0', { data: 'stale', instance_id: 1 })
    await runtime.markShellPtyStarted(entry, 2)

    expect(runtime.getShellLifecycleState('T-1-shell-0')).toMatchObject({
      currentPtyInstance: 2,
      hasOutput: false,
    })
  })

  it('resets output observed when a fresh shell instance starts', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire('T-1-shell-0')

    await runtime.markShellPtyStarted(entry, 1)
    host.emit('pty-output-T-1-shell-0', { data: '$ ', instance_id: 1 })
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(true)

    runtime.markPtySpawnPending(entry)
    await runtime.markShellPtyStarted(entry, 2)
    expect(entry.authority).toMatchObject({
      shellSessionKey: 'T-1-shell-0',
      ptyInstanceId: 2,
    })

    expect(runtime.getShellLifecycleState('T-1-shell-0')).toMatchObject({
      ptyActive: true,
      currentPtyInstance: 2,
      hasOutput: false,
    })
  })
})
