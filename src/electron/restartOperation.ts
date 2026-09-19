import { CrashSafeFilePersistence } from './crashSafeFilePersistence.js'
import type { RestartTerminalController } from './restartWorkspace.js'

export type ShutdownIntent = 'quit' | 'restart' | 'update'
type Phase = 'prepared' | 'detached' | 'reconnecting' | 'committed' | 'cancelled'
interface Operation {
  version: 1
  installationId: string
  operationId: string
  intent: Exclude<ShutdownIntent, 'quit'>
  phase: Phase
  controller: RestartTerminalController
}

/** Durable authorization, independent of the Electron process and window lifetimes. */
export class RestartOperation {
  private readonly persistence = new CrashSafeFilePersistence()

  constructor(private readonly path: string, private readonly installationId: string) {}

  prepare(operationId: string, controller: RestartTerminalController, intent: Exclude<ShutdownIntent, 'quit'>): Promise<void> {
    return this.persistence.runExclusive(async () => {
      const current = await this.read()
      if (current && !['committed', 'cancelled'].includes(current.phase)) {
        throw new Error('Restart already in progress')
      }
      await this.write({ version: 1, installationId: this.installationId, operationId, controller, intent, phase: 'prepared' })
    })
  }

  detach(operationId: string): Promise<void> {
    return this.transition(operationId, ['prepared'], 'detached')
  }

  cancel(operationId: string): Promise<void> {
    return this.transition(operationId, ['prepared'], 'cancelled')
  }

  reconnect(operationId: string, controller: RestartTerminalController): Promise<void> {
    return this.persistence.runExclusive(async () => {
      const current = await this.require(operationId)
      if (!['detached', 'reconnecting'].includes(current.phase)
        || current.controller.installation !== controller.installation
        || current.controller.lifetime !== controller.lifetime
        || controller.generation <= current.controller.generation) {
        throw new Error('Restart requires a replacement controller for the preserved daemon')
      }
      await this.write({ ...current, phase: 'reconnecting' })
    })
  }

  commit(operationId: string): Promise<void> {
    return this.transition(operationId, ['reconnecting', 'committed'], 'committed')
  }

  shutdownIntent(): Promise<ShutdownIntent> {
    return this.persistence.runExclusive(async () => {
      const current = await this.read()
      return current && ['detached', 'reconnecting'].includes(current.phase) ? current.intent : 'quit'
    })
  }

  private transition(operationId: string, from: Phase[], phase: Phase): Promise<void> {
    return this.persistence.runExclusive(async () => {
      const current = await this.require(operationId)
      if (!from.includes(current.phase)) throw new Error('Invalid restart transition')
      await this.write({ ...current, phase })
    })
  }

  private async require(operationId: string): Promise<Operation> {
    const current = await this.read()
    if (!current || current.operationId !== operationId) throw new Error('Stale restart operation')
    return current
  }

  private async read(): Promise<Operation | null> {
    const content = await this.persistence.readUtf8IfExists(this.path)
    if (content === null) return null
    const value = JSON.parse(content) as Partial<Operation> | null
    if (!value || value.version !== 1 || typeof value.operationId !== 'string' || !value.operationId
      || typeof value.installationId !== 'string'
      || !['restart', 'update'].includes(value.intent ?? '')
      || !['prepared', 'detached', 'reconnecting', 'committed', 'cancelled'].includes(value.phase ?? '')
      || typeof value.controller?.installation !== 'string' || typeof value.controller.lifetime !== 'string'
      || !Number.isSafeInteger(value.controller.generation) || value.controller.generation < 1) {
      throw new Error('Invalid restart operation record')
    }
    if (value.installationId !== this.installationId) return null
    return value as Operation
  }

  private write(operation: Operation): Promise<void> {
    return this.persistence.writeUtf8Atomic(this.path, JSON.stringify(operation))
  }
}
