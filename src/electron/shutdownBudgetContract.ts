/**
 * Rust sidecar quit-time shutdown budget contract.
 *
 * Timeline on Electron app quit:
 * 1. Electron stops the sidecar event stream before signaling the process.
 * 2. Electron sends SIGTERM and waits `RUST_SIDECAR_SIGTERM_GRACE_MS`.
 * 3. Rust handles SIGTERM and bounds internal cleanup with
 *    `RUST_SIDECAR_INTERNAL_CLEANUP_TIMEOUT_MS`.
 * 4. Electron's ShutdownCoordinator bounds the whole sidecar adapter with
 *    `RUST_SIDECAR_SHUTDOWN_COORDINATOR_DEADLINE_MS`.
 *
 * Invariant: Rust cleanup timeout < SIGTERM grace < coordinator deadline.
 * This leaves room for Rust cleanup to finish before Electron escalates, and
 * room for stopSidecar to return a structured SIGKILL report before the
 * coordinator reports a quit-time cleanup timeout.
 */
export const RUST_SIDECAR_INTERNAL_CLEANUP_TIMEOUT_MS = 5_000
export const RUST_SIDECAR_SIGTERM_GRACE_MS = 7_000
export const RUST_SIDECAR_SHUTDOWN_COORDINATOR_DEADLINE_MS = 8_000

export interface RustSidecarShutdownBudgetContract {
  readonly rustCleanupTimeoutMs: number
  readonly sigtermGraceMs: number
  readonly coordinatorDeadlineMs: number
}

export const RUST_SIDECAR_SHUTDOWN_BUDGET_CONTRACT: RustSidecarShutdownBudgetContract = Object.freeze({
  rustCleanupTimeoutMs: RUST_SIDECAR_INTERNAL_CLEANUP_TIMEOUT_MS,
  sigtermGraceMs: RUST_SIDECAR_SIGTERM_GRACE_MS,
  coordinatorDeadlineMs: RUST_SIDECAR_SHUTDOWN_COORDINATOR_DEADLINE_MS,
})

export function assertRustSidecarShutdownBudgetContract(
  contract: RustSidecarShutdownBudgetContract = RUST_SIDECAR_SHUTDOWN_BUDGET_CONTRACT,
): void {
  if (!(contract.rustCleanupTimeoutMs < contract.sigtermGraceMs)) {
    throw new Error('Rust sidecar cleanup timeout must be less than Electron SIGTERM grace')
  }

  if (!(contract.sigtermGraceMs < contract.coordinatorDeadlineMs)) {
    throw new Error('Electron SIGTERM grace must be less than the shutdown coordinator deadline')
  }
}
