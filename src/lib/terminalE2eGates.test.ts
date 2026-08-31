import { describe, expect, it, vi } from 'vitest'
import { createTerminalE2eGateCoordinator } from './terminalE2eGates'
import {
  checkpointTerminalAuthorityRead,
  configureTerminalE2eRuntime,
} from './terminalE2eRuntime'

describe('terminal E2E deferred gates', () => {
  it('holds only the matching terminal checkpoint until the gate resumes', async () => {
    const coordinator = createTerminalE2eGateCoordinator({ createId: () => 'gate-1' })
    const armed = coordinator.arm('acquisition', 'T-1-shell-0', { timeoutMs: 1_000 })

    await expect(coordinator.checkpoint('acquisition', 'T-2-shell-0', { generation: 3 })).resolves.toBeUndefined()
    const checkpoint = coordinator.checkpoint('acquisition', 'T-1-shell-0', { generation: 4 })

    await expect(coordinator.waitForState(armed.id, 'reached')).resolves.toMatchObject({
      id: 'gate-1',
      kind: 'acquisition',
      shellSessionKey: 'T-1-shell-0',
      state: 'reached',
      details: { generation: 4 },
    })
    expect(coordinator.get(armed.id).state).toBe('reached')

    coordinator.resume(armed.id)
    await expect(checkpoint).resolves.toBeUndefined()
    expect(coordinator.get(armed.id).state).toBe('resumed')
  })

  it('rejects duplicate pending gates for the same checkpoint', () => {
    let id = 0
    const coordinator = createTerminalE2eGateCoordinator({ createId: () => `gate-${++id}` })
    coordinator.arm('authoritative-read', 'T-1-shell-0')

    expect(() => coordinator.arm('authoritative-read', 'T-1-shell-0'))
      .toThrow('A pending authoritative-read gate already exists for T-1-shell-0')
    expect(() => coordinator.arm('acquisition', 'T-1-shell-0')).not.toThrow()
  })

  it('cancels a reached gate and releases its checkpoint', async () => {
    const coordinator = createTerminalE2eGateCoordinator({ createId: () => 'gate-cancel' })
    const armed = coordinator.arm('acquisition', 'T-1-shell-0')
    const checkpoint = coordinator.checkpoint('acquisition', 'T-1-shell-0')
    await coordinator.waitForState(armed.id, 'reached')

    coordinator.cancel(armed.id)

    await expect(checkpoint).resolves.toBeUndefined()
    expect(coordinator.get(armed.id).state).toBe('cancelled')
  })

  it('times out a reached checkpoint instead of deadlocking it', async () => {
    vi.useFakeTimers()
    try {
      const coordinator = createTerminalE2eGateCoordinator({ createId: () => 'gate-timeout' })
      const armed = coordinator.arm('authoritative-read', 'T-1-shell-0', { timeoutMs: 25 })
      const checkpoint = coordinator.checkpoint('authoritative-read', 'T-1-shell-0', {
        ptyInstanceId: 7,
        watermark: 12,
      })
      await coordinator.waitForState(armed.id, 'reached')

      const timedOut = expect(checkpoint).rejects.toThrow('Terminal E2E gate gate-timeout timed out')
      await vi.advanceTimersByTimeAsync(25)
      await timedOut
      expect(coordinator.get(armed.id)).toMatchObject({
        state: 'timed-out',
        details: { ptyInstanceId: 7, watermark: 12 },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects unknown gates and invalid state transitions', () => {
    const coordinator = createTerminalE2eGateCoordinator({ createId: () => 'gate-1' })
    const gate = coordinator.arm('acquisition', 'T-1-shell-0')

    expect(() => coordinator.resume('missing')).toThrow('Unknown terminal E2E gate: missing')
    expect(() => coordinator.resume(gate.id)).toThrow('cannot resume from armed')
    coordinator.cancel(gate.id)
    expect(() => coordinator.cancel(gate.id)).toThrow('cannot cancel from cancelled')
  })

  it('keeps production checkpoint hooks synchronous until a coordinator is configured', async () => {
    configureTerminalE2eRuntime(null)
    expect(checkpointTerminalAuthorityRead('T-1-shell-0', { ptyInstanceId: 7, watermark: 12 })).toBeUndefined()

    const coordinator = createTerminalE2eGateCoordinator({ createId: () => 'gate-wired' })
    configureTerminalE2eRuntime(coordinator)
    const gate = coordinator.arm('authoritative-read', 'T-1-shell-0')
    const checkpoint = checkpointTerminalAuthorityRead('T-1-shell-0', { ptyInstanceId: 7, watermark: 12 })
    await coordinator.waitForState(gate.id, 'reached')

    coordinator.resume(gate.id)
    await expect(checkpoint).resolves.toBeUndefined()
    configureTerminalE2eRuntime(null)
  })
})
