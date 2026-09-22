import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { RestartOperation } from './restartOperation.js'
import { RestartWorkspaceIpc } from './restartWorkspaceIpc.js'
import { RestartWorkspaceStore } from './restartWorkspaceStore.js'
import type { RestartTerminalInventory } from './restartWorkspace.js'
import { parseUpdateTarget, requireUpdateDriver, verifyUpdateReadiness, type AppUpdateDriver } from './appUpdateVerification.js'

export interface RestartBackend {
  prepare(operationId: string, intent: 'restart' | 'update'): Promise<void>
  cancel(operationId: string): Promise<void>
  detach(operationId: string): Promise<void>
  commit(operationId: string): Promise<void>
}

export async function createControlledRestartHost(options: {
  root: string
  operationId: string | null
  intent?: 'restart' | 'update'
  backend?: RestartBackend
  update?: AppUpdateDriver
  inventory(): Promise<RestartTerminalInventory>
  replace(operationId: string): Promise<void>
}): Promise<RestartWorkspaceIpc> {
  if (options.intent === 'update') requireUpdateDriver(options.update)
  const initial = await options.inventory()
  const daemonInstallation = initial.controller.installation
  const installationId = createHash('sha256').update(JSON.stringify([options.root, daemonInstallation])).digest('hex')
  const store = new RestartWorkspaceStore(join(options.root, 'restart-workspace.json'), installationId)
  const operation = new RestartOperation(join(options.root, 'restart-operation.json'), installationId)
  async function validateCompletion(): Promise<void> {
    const record = await operation.status()
    const current = await options.inventory()
    if (current.controller.installation !== initial.controller.installation
      || current.controller.lifetime !== initial.controller.lifetime
      || current.controller.generation !== initial.controller.generation) {
      throw new Error('Restart controller changed before restoration completed')
    }
    if (record?.intent === 'update') {
      try {
        await verifyUpdateReadiness(options.update, record.updateTarget, current.controller)
      } catch (error) {
        await operation.fail(record.operationId, 'activation-failed')
        throw error
      }
    }
  }
  const pending = await operation.status()
  async function commitUpdate(operationId: string): Promise<void> {
    const record = await operation.status()
    if (record?.operationId !== operationId) throw new Error('Stale update completion')
    if (record?.intent === 'update') {
      if (!record.updateTarget) throw new Error('Update target is missing')
      await requireUpdateDriver(options.update).commit(parseUpdateTarget(record.updateTarget))
    }
  }
  if (!options.operationId && pending?.phase === 'prepared'
    && initial.controller.generation > pending.controller.generation) {
    await options.backend?.cancel(pending.operationId)
    await operation.cancel(pending.operationId)
  }
  const acknowledged = options.operationId && await store.allWindowsAcknowledged(options.operationId)
  if (options.operationId && (await store.load(options.operationId) || acknowledged)) {
    if (!acknowledged || await operation.shutdownIntent() !== 'quit') await operation.reconnect(options.operationId, initial.controller)
    if (acknowledged) {
      await validateCompletion()
      await options.backend?.commit(options.operationId)
      await commitUpdate(options.operationId)
      await operation.commit(options.operationId)
    }
  }
  return new RestartWorkspaceIpc(
    store,
    options.operationId,
    async (operationId, assertCurrent) => {
      const current = await options.inventory()
      if (current.controller.installation !== daemonInstallation) throw new Error('Daemon installation changed during capture')
      if (current.controller.lifetime !== initial.controller.lifetime
        || current.controller.generation !== initial.controller.generation) {
        throw new Error('Daemon controller changed during capture')
      }
      if (current.hasLegacySessions !== false) throw new Error('Controlled restart cannot preserve legacy processes')
      assertCurrent()
      // Persist authorization before the remote call: a lost acknowledgement
      // cannot tell us whether the Sidecar has already detached.
      await operation.detach(operationId)
      await options.backend?.detach(operationId)
      assertCurrent()
      const record = await operation.status()
      if (record?.intent === 'update') {
        if (!record.updateTarget) throw new Error('Update target is missing')
        await requireUpdateDriver(options.update).replace(record.updateTarget)
      } else {
        await options.replace(operationId)
      }
    },
    {
      prepare: async operationId => {
        const intent = options.intent ?? 'restart'
        const target = intent === 'update'
          ? parseUpdateTarget(await requireUpdateDriver(options.update).preflight({ installationId, operationId }))
          : undefined
        try {
          await operation.prepare(operationId, initial.controller, intent, initial.daemonRoot, target)
        } catch (error) {
          if (target) await requireUpdateDriver(options.update).cancel(target)
          throw error
        }
        await options.backend?.prepare(operationId, intent)
      },
      cancel: async operationId => {
        // A failed relaunch must never turn an authorized replacement into Quit.
        const record = await operation.status()
        if (record?.operationId === operationId && record.phase === 'prepared') {
          try {
            await options.backend?.cancel(operationId)
          } finally {
            if (record.intent === 'update' && record.updateTarget) await requireUpdateDriver(options.update).cancel(record.updateTarget)
          }
          await operation.cancel(operationId)
        }
      },
      validateCompletion,
      complete: async operationId => {
        await validateCompletion()
        await options.backend?.commit(operationId)
        await commitUpdate(operationId)
        await operation.commit(operationId)
      },
      shutdownIntent: () => operation.shutdownIntent(),
    },
  )
}
