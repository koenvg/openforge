import { parseUpdateTarget, type UpdateTarget } from './appUpdateVerification.js'
import { RestartOperation } from './restartOperation.js'

/** Runs before creating a Sidecar, including its keychain/database initialization. */
export async function preflightProductionUpdateLaunch(root: string, launch?: {
  operationId: string | null
  authorize(target: UpdateTarget): Promise<void>
}): Promise<UpdateTarget | undefined> {
  const record = await (await RestartOperation.open(root))?.status()
  if (record?.intent !== 'update' || !['prepared', 'detached', 'reconnecting'].includes(record.phase)) return
  if (!launch || record.phase === 'prepared' || launch.operationId !== record.operationId || !record.updateTarget) {
    throw new Error('Update launch requires trusted-release verification; the Sidecar was not started. Use compatible update recovery, not an older app or database rollback.')
  }
  const target = parseUpdateTarget(record.updateTarget)
  await launch.authorize(target)
  return target
}
