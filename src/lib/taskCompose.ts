import { writable } from 'svelte/store'
import type { ComposeTaskRequest, ComposeTaskResult } from '@openforge-app/plugin-sdk'

export interface PendingComposeRequest {
  request: ComposeTaskRequest
}

const pending = writable<PendingComposeRequest | null>(null)
export const pendingComposeRequest = { subscribe: pending.subscribe }

let settle: ((result: ComposeTaskResult | null) => void) | null = null

/**
 * Opens the host's create-task dialog seeded from `request` and resolves with
 * what the user did, or null if they dismissed it. Only one compose can be in
 * flight; a second request cancels the first rather than queueing behind it.
 */
export function requestTaskCompose(request: ComposeTaskRequest): Promise<ComposeTaskResult | null> {
  settle?.(null)
  return new Promise<ComposeTaskResult | null>((resolve) => {
    settle = resolve
    pending.set({ request })
  })
}

/**
 * Settles the in-flight compose. Deliberately idempotent: the dialog reports the
 * saved task and then closes, and the close must not overwrite that result with
 * a cancellation.
 */
export function settleTaskCompose(result: ComposeTaskResult | null): void {
  const resolve = settle
  settle = null
  pending.set(null)
  resolve?.(result)
}
