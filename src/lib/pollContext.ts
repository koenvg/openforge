import type { AppView } from './types'

/**
 * The poll context the renderer reports to the sidecar GitHub poller.
 * Drives focus-gating and view-scoped polling.
 */
export interface PollContextInput {
  /** Whether the app window currently has focus / is visible. */
  focused: boolean
  /** The active project's id, or null when none is active. */
  activeProjectId: string | null
  /** The currently active app view. */
  currentView: AppView
  /** The view key that represents the global (all-repos) PR view. */
  globalPrViewKey: AppView
}

export interface PollContextPayload {
  focused: boolean
  activeProjectId: string | null
  globalViewOpen: boolean
}

/**
 * Pure mapping from renderer state to the poll-context payload sent to the sidecar.
 *
 * The global PR view (all repos) opts the poller back into polling every project;
 * any other view scopes polling to the active project's repo.
 */
export function computePollContext(input: PollContextInput): PollContextPayload {
  return {
    focused: input.focused,
    activeProjectId: input.activeProjectId,
    globalViewOpen: input.currentView === input.globalPrViewKey,
  }
}

/**
 * Whether two payloads are equivalent — used to avoid redundant IPC calls when a
 * store update doesn't actually change the reported context.
 */
export function pollContextEquals(a: PollContextPayload, b: PollContextPayload): boolean {
  return (
    a.focused === b.focused &&
    a.activeProjectId === b.activeProjectId &&
    a.globalViewOpen === b.globalViewOpen
  )
}
