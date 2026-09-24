import { dialog } from 'electron'
import { parseUpdateTarget, type UpdateTarget } from './appUpdateVerification.js'
import { RestartOperation, type RecoveryFailure, type RestartOperationRecord } from './restartOperation.js'

export interface UpdateRecoveryActions {
  retry(target: UpdateTarget): Promise<void>
  /** Close this app only after its owned backend has safely retired. Never terminate sessions. */
  close(): Promise<void>
}

interface Options extends UpdateRecoveryActions { root: string }

function pendingUpdate(record: RestartOperationRecord | null | undefined): record is RestartOperationRecord {
  return !!record && record.intent === 'update' && !['committed', 'cancelled', 'terminated'].includes(record.phase)
}

/** Update recovery has no ordinary relaunch or controller-acquiring CLI fallback. */
export class NativeUpdateRecovery {
  private active: Promise<boolean> | null = null

  constructor(private readonly options: Options) {}

  recover(failure?: RecoveryFailure): Promise<boolean> {
    this.active ??= this.perform(failure).finally(() => { this.active = null })
    return this.active
  }

  private async perform(failure?: RecoveryFailure): Promise<boolean> {
    const operation = await RestartOperation.open(this.options.root)
    let record = await operation?.status()
    if (!operation || !pendingUpdate(record)) return false
    const operationId = record.operationId
    if (failure && record.failure !== 'cold-process-loss') {
      await operation.fail(operationId, record.phase === 'prepared' && failure !== 'cold-process-loss' ? 'preparation-failed' : failure)
    }
    let error: string | undefined
    for (;;) {
      record = await operation.status()
      if (!pendingUpdate(record) || record.operationId !== operationId) return true
      const choice = await dialog.showMessageBox({
        type: 'warning', title: 'Update recovery',
        message: record.failure === 'cold-process-loss'
          ? 'The original session process was lost. Session history is not uninterrupted continuity.'
          : 'OpenForge could not finish the update.',
        detail: `Retry verifies the approved installed build and starts it through the native updater. Recovery does not stop surviving sessions or roll back the app or database.${error ? `\n\n${error}` : ''}`,
        buttons: ['Retry update', 'Close app and leave sessions running', 'Keep waiting'],
        defaultId: 2, cancelId: 2, noLink: true,
      })
      const current = await operation.status()
      if (!pendingUpdate(current) || current.operationId !== operationId) return true
      if (choice.response !== 0 && choice.response !== 1) return true
      try {
        if (choice.response === 0) await this.options.retry(parseUpdateTarget(current.updateTarget))
        else await this.options.close()
        return true
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
    }
  }
}
