import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { RestartOperation } from './restartOperation'
import type { RestartOperationRecord } from './restartOperation'
import { RestartRecovery } from './restartRecovery'
import { createControlledRestartHost } from './controlledRestartHost'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(detach = true, intent: 'restart' | 'update' = 'restart') {
  const root = await mkdtemp(join(tmpdir(), 'of-recovery-'))
  roots.push(root)
  const controller = { installation: 'installation', lifetime: 'daemon', generation: 1 }
  const identity = createHash('sha256').update(JSON.stringify([root, controller.installation])).digest('hex')
  const operation = new RestartOperation(join(root, 'restart-operation.json'), identity)
  await operation.prepare('operation', controller, intent, '/isolated/daemon')
  if (detach) await operation.detach('operation')
  return { root, operation, controller }
}

it('reports failed activation durably and serializes retries without completing the restart', async () => {
  const { root, operation } = await fixture()
  const retry = vi.fn(async () => {})
  const terminate = vi.fn(async () => {})
  const prompt = vi.fn(async (_record: RestartOperationRecord, _error?: string) => 'retry' as const)
  const recovery = new RestartRecovery({ root, retry, terminate, prompt, exit: vi.fn() })
  await Promise.all([recovery.recover('activation-failed'), recovery.recover('activation-failed')])
  expect(retry).toHaveBeenCalledExactlyOnceWith('operation')
  expect(terminate).not.toHaveBeenCalled()
  expect(prompt.mock.calls[0][0].failure).toBe('activation-failed')
  expect(await operation.shutdownIntent()).toBe('restart')
  await expect((await RestartOperation.open(root))?.status()).resolves.toMatchObject({ phase: 'detached', failure: 'activation-failed' })
})

it('normal Quit authenticates cleanup without Sidecar and records termination, not restart success', async () => {
  const { root, operation, controller } = await fixture()
  const terminate = vi.fn(async () => {})
  const exit = vi.fn()
  const recovery = new RestartRecovery({ root, retry: vi.fn(), terminate, prompt: vi.fn(), exit })
  expect(await recovery.quit()).toBe(true)
  expect(terminate).toHaveBeenCalledExactlyOnceWith({ root: '/isolated/daemon', controller })
  expect(exit).toHaveBeenCalledOnce()
  expect(await operation.status()).toMatchObject({ phase: 'terminated' })
})

it('failed authentication keeps recovery available without exit or fabricated authority', async () => {
  const { root, operation } = await fixture()
  const exit = vi.fn()
  const terminate = vi.fn().mockRejectedValueOnce(new Error('reauthentication required')).mockResolvedValue(undefined)
  const prompt = vi.fn(async (_record: RestartOperationRecord, _error?: string) => 'quit' as const)
  const recovery = new RestartRecovery({ root, retry: vi.fn(), terminate, prompt, exit })
  await recovery.recover('activation-failed')
  expect(prompt).toHaveBeenCalledTimes(2)
  expect(prompt.mock.calls[1][1]).toContain('reauthentication required')
  expect(exit).toHaveBeenCalledOnce()
  expect(await operation.status()).toMatchObject({ phase: 'terminated' })
})

it('does not replay recovery if workspace completion arrives while the dialog is open', async () => {
  const { root, operation, controller } = await fixture()
  await operation.reconnect('operation', { ...controller, generation: 2 })
  const retry = vi.fn()
  const recovery = new RestartRecovery({ root, retry, terminate: vi.fn(), exit: vi.fn(),
    prompt: async () => { await operation.commit('operation'); return 'retry' },
  })
  await recovery.recover('interface-restoration-incomplete')
  expect(retry).not.toHaveBeenCalled()
  expect(await operation.status()).toMatchObject({ phase: 'committed' })
})

it('cancels interrupted ordinary restart preparation on a later healthy launch', async () => {
  const { root, operation, controller } = await fixture(false)
  const cancel = vi.fn(async () => {})
  const host = await createControlledRestartHost({ root, operationId: null, replace: async () => {},
    inventory: async () => ({ controller: { ...controller, generation: 2 }, sessions: [], hasLegacySessions: false }),
    backend: { prepare: vi.fn(), detach: vi.fn(), commit: vi.fn(), cancel },
  })
  expect(cancel).toHaveBeenCalledExactlyOnceWith('operation')
  expect(await operation.status()).toMatchObject({ phase: 'cancelled', failure: 'preparation-failed' })
  expect(await host.shutdownIntent()).toBe('quit')
})

it('keeps cold process loss distinct from interface failure and never claims live continuity', async () => {
  const { root, operation, controller } = await fixture()
  await expect(operation.reconnect('operation', { ...controller, lifetime: 'replacement', generation: 2 })).rejects.toThrow('not uninterrupted continuity')
  const prompt = vi.fn(async (_record: RestartOperationRecord) => 'wait' as const)
  const retry = vi.fn()
  const recovery = new RestartRecovery({ root, prompt, retry, terminate: vi.fn(), exit: vi.fn() })
  await recovery.recover('interface-restoration-incomplete')
  expect(prompt.mock.calls[0][0].failure).toBe('cold-process-loss')
  expect(retry).not.toHaveBeenCalled()
  expect(await operation.shutdownIntent()).toBe('restart')
})

it('classifies a failed preparation before detach separately from a delayed relaunch', async () => {
  const { root, operation } = await fixture(false)
  const prompt = vi.fn(async (_record: RestartOperationRecord) => 'wait' as const)
  await new RestartRecovery({ root, prompt, retry: vi.fn(), terminate: vi.fn(), exit: vi.fn() }).recover('relaunch-delayed')
  expect(await operation.status()).toMatchObject({ phase: 'prepared', failure: 'preparation-failed' })
  expect(prompt.mock.calls[0][0].failure).toBe('preparation-failed')
})

it('never handles update retry or Quit through ordinary restart recovery', async () => {
  const { root, operation } = await fixture(true, 'update')
  const prompt = vi.fn(async () => 'wait' as const)
  const terminate = vi.fn(async () => {})
  const recovery = new RestartRecovery({ root, prompt, terminate, retry: vi.fn(), exit: vi.fn() })
  expect(await recovery.recover('activation-failed')).toBe(false)
  expect(await recovery.quit()).toBe(false)
  expect(prompt).not.toHaveBeenCalled()
  expect(terminate).not.toHaveBeenCalled()
  expect(await operation.status()).toMatchObject({ intent: 'update', phase: 'detached' })
})
