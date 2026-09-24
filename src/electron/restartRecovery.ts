import { RestartOperation } from './restartOperation.js'
import type { RecoveryFailure, RestartOperationRecord } from './restartOperation.js'
import type { RestartTerminalController } from './restartWorkspace.js'

interface RecoveryActions {
  root: string
  prompt(record: RestartOperationRecord, error?: string): Promise<'retry' | 'quit' | 'wait'>
  retry(operationId: string): Promise<void>
  terminate(target: { root: string; controller: RestartTerminalController }): Promise<void>
  exit(): void
}

/** Native recovery stays available even when neither the renderer nor Sidecar boots. */
export class RestartRecovery {
  private active: Promise<boolean> | null = null
  constructor(private readonly actions: RecoveryActions) {}

  recover(failure: RecoveryFailure, error?: string): Promise<boolean> {
    return this.run(failure, false, error)
  }

  quit(): Promise<boolean> {
    return this.run(undefined, true)
  }

  private run(failure: RecoveryFailure | undefined, quit: boolean, error?: string): Promise<boolean> {
    if (this.active) return this.active
    this.active = this.perform(failure, quit, error).finally(() => { this.active = null })
    return this.active
  }

  private async perform(failure: RecoveryFailure | undefined, quit: boolean, error?: string): Promise<boolean> {
    const operation = await RestartOperation.open(this.actions.root)
    let record = await operation?.status()
    if (!operation || !record || ['committed', 'cancelled', 'terminated'].includes(record.phase)) return false
    if (record.intent !== 'restart') return false
    if (failure && record.failure !== 'cold-process-loss') {
      await operation.fail(record.operationId, record.phase === 'prepared' && failure !== 'cold-process-loss' ? 'preparation-failed' : failure)
      record = (await operation.status())!
    }
    for (;;) {
      const choice = quit ? 'quit' : await this.actions.prompt(record, error)
      const latest = await operation.status()
      if (!latest || ['committed', 'cancelled', 'terminated'].includes(latest.phase)) return true
      if (latest.operationId !== record.operationId || latest.intent !== 'restart') return true
      record = latest
      if (choice === 'wait') return true
      quit = false
      try {
        if (choice === 'retry') {
          await this.actions.retry(record.operationId)
        } else {
          if (!record.daemonRoot) throw new Error('No verified daemon location was saved. Use authenticated local recovery; do not guess ownership.')
          await this.actions.terminate({ root: record.daemonRoot, controller: record.controller })
          await operation.terminated(record.operationId)
          this.actions.exit()
        }
        return true
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
    }
  }
}
