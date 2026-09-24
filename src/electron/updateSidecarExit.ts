import type { ChildProcessLike, SidecarHandle } from './sidecar.js'
import { RUST_SIDECAR_SHUTDOWN_COORDINATOR_DEADLINE_MS } from './shutdownBudgetContract.js'

/** Tracks the spawned child, not a PID lookup or a successful signal request. */
export class UpdateSidecarExit {
  private readonly exited: Promise<void>
  private exitObserved = false

  constructor(private readonly child: ChildProcessLike) {
    // Construct at spawn time, before readiness, so an early exit cannot be missed.
    this.exited = new Promise(resolve => child.once('exit', () => { this.exitObserved = true; resolve() }))
  }

  /** Only the coordinator may call this, after authenticated update detach. */
  async stop(handle: SidecarHandle, deadlineMs = RUST_SIDECAR_SHUTDOWN_COORDINATOR_DEADLINE_MS): Promise<void> {
    if (handle.process !== this.child) throw new Error('Update Sidecar ownership changed')
    await this.stopAndObserve(() => handle.stop(), deadlineMs)
  }

  /** Observe the owned child without signalling it or trusting a previous kill request. */
  async wait(child: ChildProcessLike, deadlineMs = RUST_SIDECAR_SHUTDOWN_COORDINATOR_DEADLINE_MS): Promise<void> {
    if (child !== this.child) throw new Error('Update Sidecar ownership changed')
    await this.stopAndObserve(() => {}, deadlineMs)
  }

  /** Retire an admitted update child on startup/recovery failure, without Quit cleanup. */
  async retire(child: ChildProcessLike, deadlineMs = RUST_SIDECAR_SHUTDOWN_COORDINATOR_DEADLINE_MS): Promise<void> {
    if (child !== this.child) throw new Error('Update Sidecar ownership changed')
    if (this.exitObserved) return
    await this.stopAndObserve(() => child.kill('SIGKILL'), deadlineMs)
  }

  private async stopAndObserve(stop: () => unknown, deadlineMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        (async () => { await stop(); await this.exited })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Owned Sidecar exit was not observed')), deadlineMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}
