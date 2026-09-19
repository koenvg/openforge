import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { RestartOperation } from './restartOperation.js'
import { RestartWorkspaceIpc } from './restartWorkspaceIpc.js'
import { RestartWorkspaceStore } from './restartWorkspaceStore.js'
import type { RestartTerminalInventory } from './restartWorkspace.js'

export async function createControlledRestartHost(options: {
  root: string
  operationId: string | null
  intent?: 'restart' | 'update'
  inventory(): Promise<RestartTerminalInventory>
  replace(operationId: string): Promise<void>
}): Promise<RestartWorkspaceIpc> {
  const initial = await options.inventory()
  const daemonInstallation = initial.controller.installation
  const installationId = createHash('sha256').update(JSON.stringify([options.root, daemonInstallation])).digest('hex')
  const store = new RestartWorkspaceStore(join(options.root, 'restart-workspace.json'), installationId)
  const operation = new RestartOperation(join(options.root, 'restart-operation.json'), installationId)
  if (options.operationId && await store.load(options.operationId)) {
    await operation.reconnect(options.operationId, initial.controller)
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
      await operation.detach(operationId)
      await options.replace(operationId)
    },
    {
      prepare: operationId => operation.prepare(operationId, initial.controller, options.intent ?? 'restart'),
      cancel: async operationId => {
        // A failed relaunch must never turn an authorized replacement into Quit.
        if (await operation.shutdownIntent() === 'quit') await operation.cancel(operationId)
      },
      validateCompletion: async () => {
        const current = await options.inventory()
        if (current.controller.installation !== initial.controller.installation
          || current.controller.lifetime !== initial.controller.lifetime
          || current.controller.generation !== initial.controller.generation) {
          throw new Error('Restart controller changed before restoration completed')
        }
      },
      complete: operationId => operation.commit(operationId),
      shutdownIntent: () => operation.shutdownIntent(),
    },
  )
}
