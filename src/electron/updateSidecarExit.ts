import type { ChildProcessLike, SidecarHandle } from './sidecar.js'
import { RUST_SIDECAR_SHUTDOWN_COORDINATOR_DEADLINE_MS } from './shutdownBudgetContract.js'

/** Tracks the spawned child, not a PID lookup or a successful signal request. */
export class UpdateSidecarExit {
  private readonly exited: Promise<void>

  constructor(private readonly child: ChildProcessLike) {
    // Construct at spawn time, before readiness, so an early exit cannot be missed.
    this.exited = new Promise(resolve => child.once('exit', () => resolve()))
  }

  /** Only the coordinator may call this, after authenticated update detach. */
  async stop(handle: SidecarHandle, deadlineMs = RUST_SIDECAR_SHUTDOWN_COORDINATOR_DEADLINE_MS): Promise<void> {
    if (handle.process !== this.child) throw new Error('Update Sidecar ownership changed')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        (async () => { await handle.stop(); await this.exited })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Owned Sidecar exit was not observed')), deadlineMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}
