import { RestartOperation } from './restartOperation.js'

/**
 * Runs before creating a Sidecar, not after its migrations or readiness handshake.
 * This gate has no environment override. Until publisher and launch verification
 * exist, even a saved target manifest is not authority to run a domain backend.
 */
export async function preflightProductionUpdateLaunch(root: string): Promise<void> {
  const record = await (await RestartOperation.open(root))?.status()
  if (record?.intent === 'update' && ['prepared', 'detached', 'reconnecting'].includes(record.phase)) {
    throw new Error('Update launch requires trusted-release verification; the Sidecar was not started. Use compatible update recovery, not an older app or database rollback.')
  }
}
