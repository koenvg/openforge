import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { CrashSafeFilePersistence } from './crashSafeFilePersistence.js'
import type { RestartTerminalController } from './restartWorkspace.js'

export type ShutdownIntent = 'quit' | 'restart' | 'update'
export type RecoveryFailure = 'preparation-failed' | 'activation-failed' | 'relaunch-delayed' | 'interface-restoration-incomplete' | 'cold-process-loss'
type Phase = 'prepared' | 'detached' | 'reconnecting' | 'committed' | 'cancelled' | 'terminated'
export interface RestartOperationRecord {
  version: 1
  installationId: string
  operationId: string
  intent: Exclude<ShutdownIntent, 'quit'>
  phase: Phase
  controller: RestartTerminalController
  daemonRoot?: string
  failure?: RecoveryFailure
}
const terminal = (phase: Phase) => ['committed', 'cancelled', 'terminated'].includes(phase)
const operationFiles = new Map<string, CrashSafeFilePersistence>()

/** Durable authorization. Recovery reads this before the Sidecar is available. */
export class RestartOperation {
  private readonly persistence: CrashSafeFilePersistence
  constructor(private readonly path: string, private readonly installationId: string) {
    const persistence = operationFiles.get(path) ?? new CrashSafeFilePersistence()
    operationFiles.set(path, persistence)
    this.persistence = persistence
  }

  static async open(root: string): Promise<RestartOperation | null> {
    const path = join(root, 'restart-operation.json')
    const record = await readRecord(path)
    if (!record) return null
    const identity = createHash('sha256').update(JSON.stringify([root, record.controller.installation])).digest('hex')
    if (identity !== record.installationId) throw new Error('Restart belongs to a different installation')
    return new RestartOperation(path, identity)
  }

  status(): Promise<RestartOperationRecord | null> {
    return this.persistence.runExclusive(() => this.read())
  }

  prepare(operationId: string, controller: RestartTerminalController, intent: Exclude<ShutdownIntent, 'quit'>, daemonRoot?: string): Promise<void> {
    return this.persistence.runExclusive(async () => {
      const current = await this.read()
      if (current && !terminal(current.phase)) throw new Error('Restart already in progress')
      await this.write({ version: 1, installationId: this.installationId, operationId, controller, intent, phase: 'prepared', daemonRoot })
    })
  }

  detach(operationId: string): Promise<void> {
    return this.transition(operationId, ['prepared', 'detached'], 'detached', 'relaunch-delayed')
  }

  cancel(operationId: string): Promise<void> {
    return this.transition(operationId, ['prepared', 'cancelled'], 'cancelled', 'preparation-failed')
  }

  reconnect(operationId: string, controller: RestartTerminalController): Promise<void> {
    return this.persistence.runExclusive(async () => {
      const current = await this.require(operationId)
      if (current.controller.lifetime !== controller.lifetime) {
        await this.write({ ...current, failure: 'cold-process-loss' })
        throw new Error('The original session process was lost. History recovery is not uninterrupted continuity.')
      }
      if (!['detached', 'reconnecting'].includes(current.phase)
        || current.controller.installation !== controller.installation
        || controller.generation <= current.controller.generation) {
        throw new Error('Restart requires a replacement controller for the preserved daemon')
      }
      await this.write({ ...current, phase: 'reconnecting', failure: 'interface-restoration-incomplete' })
    })
  }

  commit(operationId: string): Promise<void> {
    return this.transition(operationId, ['reconnecting', 'committed'], 'committed')
  }

  terminated(operationId: string): Promise<void> {
    return this.transition(operationId, ['prepared', 'detached', 'reconnecting', 'terminated'], 'terminated')
  }

  fail(operationId: string, failure: RecoveryFailure): Promise<void> {
    return this.persistence.runExclusive(async () => {
      const current = await this.require(operationId)
      if (!terminal(current.phase)) await this.write({ ...current, failure })
    })
  }

  shutdownIntent(): Promise<ShutdownIntent> {
    return this.persistence.runExclusive(async () => {
      const current = await this.read()
      return current && ['detached', 'reconnecting'].includes(current.phase) ? current.intent : 'quit'
    })
  }

  private transition(operationId: string, from: Phase[], phase: Phase, failure?: RecoveryFailure): Promise<void> {
    return this.persistence.runExclusive(async () => {
      const current = await this.require(operationId)
      if (!from.includes(current.phase)) throw new Error('Invalid restart transition')
      await this.write({ ...current, phase, failure })
    })
  }

  private async require(operationId: string): Promise<RestartOperationRecord> {
    const current = await this.read()
    if (!current || current.operationId !== operationId) throw new Error('Stale restart operation')
    return current
  }

  private async read(): Promise<RestartOperationRecord | null> {
    const value = await readRecord(this.path)
    return value?.installationId === this.installationId ? value : null
  }

  private write(operation: RestartOperationRecord): Promise<void> {
    return this.persistence.writeUtf8Atomic(this.path, JSON.stringify(operation))
  }
}

async function readRecord(path: string): Promise<RestartOperationRecord | null> {
  const content = await new CrashSafeFilePersistence().readUtf8IfExists(path)
  if (content === null) return null
  const value = JSON.parse(content) as Partial<RestartOperationRecord> | null
  if (!value || value.version !== 1 || typeof value.operationId !== 'string' || !value.operationId
    || typeof value.installationId !== 'string'
    || !['restart', 'update'].includes(value.intent ?? '')
    || !['prepared', 'detached', 'reconnecting', 'committed', 'cancelled', 'terminated'].includes(value.phase ?? '')
    || typeof value.controller?.installation !== 'string' || typeof value.controller.lifetime !== 'string'
    || !Number.isSafeInteger(value.controller.generation) || value.controller.generation < 1
    || (value.daemonRoot !== undefined && (typeof value.daemonRoot !== 'string' || !isAbsolute(value.daemonRoot)))
    || (value.failure !== undefined && !['preparation-failed', 'activation-failed', 'relaunch-delayed', 'interface-restoration-incomplete', 'cold-process-loss'].includes(value.failure))) {
    throw new Error('Invalid restart operation record')
  }
  return value as RestartOperationRecord
}
