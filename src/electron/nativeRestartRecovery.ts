import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { dialog } from 'electron'
import { RestartOperation } from './restartOperation.js'
import type { RecoveryFailure } from './restartOperation.js'
import { RestartRecovery } from './restartRecovery.js'
import type { RestartTerminalController } from './restartWorkspace.js'
import { resolveElectronSidecarPath } from './sidecarPath.js'
import { NativeUpdateRecovery, type UpdateRecoveryActions } from './nativeUpdateRecovery.js'

const messages: Record<RecoveryFailure, string> = {
  'update-verification-unavailable': 'Update launch verification is unavailable. The Sidecar was not started, so it cannot change the database. A trusted compatible update is required.',
  'preparation-failed': 'Restart preparation did not finish.',
  'activation-failed': 'The replacement backend did not become ready.',
  'relaunch-delayed': 'The replacement app has not attached yet.',
  'interface-restoration-incomplete': 'Workspace restoration has not finished.',
  'cold-process-loss': 'The original session process was lost. History recovery starts new processes; it is not uninterrupted continuity.',
}
interface Options {
  root: string
  env: NodeJS.ProcessEnv
  currentDir: string
  relaunch(operationId: string | null): void
  quit(): void
  update: UpdateRecoveryActions
}

/** Owns native dialogs and the authenticated local CLI, never an older Sidecar. */
export class NativeRestartRecovery {
  private readonly recovery: RestartRecovery
  private readonly updateRecovery: NativeUpdateRecovery
  constructor(private readonly options: Options) {
    this.updateRecovery = new NativeUpdateRecovery({ root: options.root, ...options.update })
    this.recovery = new RestartRecovery({
      root: options.root,
      retry: async operationId => {
        const record = await (await RestartOperation.open(options.root))?.status()
        if (!record || record.intent !== 'restart' || record.operationId !== operationId) throw new Error('Restart operation changed during recovery')
        options.relaunch(record?.phase === 'prepared' ? null : operationId)
      },
      terminate: async target => {
        const result = await this.command('--terminate-sessions', target)
        if (!['terminated', 'cold-process-loss'].includes(JSON.parse(result.stdout).state)) {
          throw new Error('Local recovery did not confirm session termination')
        }
      },
      prompt: async (record, error) => {
        const result = await dialog.showMessageBox({
          type: 'warning', title: 'Restart not completed',
          message: messages[record.failure ?? 'relaunch-delayed'],
          detail: `Readiness deadlines do not stop surviving sessions. Retry attaches again; Quit stops only verified owned sessions. Authentication failures require reauthentication. No older Sidecar or database rollback is attempted.${error ? `\n\n${error}` : ''}`,
          buttons: ['Retry attachment', 'Quit and stop sessions', 'Keep waiting'], defaultId: 0, cancelId: 2, noLink: true,
        })
        return result.response === 0 ? 'retry' : result.response === 1 ? 'quit' : 'wait'
      },
      exit: options.quit,
    })
  }

  async recover(failure: RecoveryFailure): Promise<boolean> {
    return await this.updateRecovery.recover(failure) || this.recovery.recover(failure)
  }

  async quit(): Promise<boolean> {
    return await this.updateRecovery.recover() || this.recovery.quit()
  }

  async recoverBoot(failure: RecoveryFailure): Promise<boolean> {
    if (await this.updateRecovery.recover(failure)) return true
    // Boot has stopped its failed Sidecar before probing. Reauthentication here
    // cannot steal the controller from a healthy Sidecar in this Electron process.
    const record = await (await RestartOperation.open(this.options.root))?.status()
    let error: string | undefined
    if (record?.intent === 'restart' && record.daemonRoot && !['committed', 'cancelled', 'terminated'].includes(record.phase)) {
      try {
        const result = await this.command('--recovery-status', { root: record.daemonRoot, controller: record.controller })
        if (JSON.parse(result.stdout).state === 'cold-process-loss') failure = 'cold-process-loss'
      } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    }
    return this.recovery.recover(failure, error)
  }

  private async command(mode: '--terminate-sessions' | '--recovery-status', target: { root: string; controller: RestartTerminalController }) {
    const record = await (await RestartOperation.open(this.options.root))?.status()
    if (record?.intent === 'update') throw new Error('Update recovery cannot use the ordinary restart CLI')
    const sidecar = resolveElectronSidecarPath(this.options.env, this.options.currentDir)
    const executable = this.options.env.OPENFORGE_SESSION_DAEMON_PATH || (sidecar
      ? join(dirname(sidecar), 'openforge-session-daemon')
      : join(this.options.currentDir, '..', '..', '..', 'MacOS', 'openforge-session-daemon'))
    return promisify(execFile)(executable, [mode, target.root, target.controller.installation, target.controller.lifetime], { timeout: 30_000, maxBuffer: 64 * 1024 })
  }
}
