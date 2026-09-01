import { writable } from 'svelte/store'
import type { FileBrowserWorkspaceState } from './fileExplorer'
import type { FileBrowserWorkspaceIdentity } from './workspaceSource'

export interface PendingFileRevealRequest {
  requestId: number
  workspaceIdentity: FileBrowserWorkspaceIdentity | null
  path: string
}

export const pendingFileReveal = writable<PendingFileRevealRequest | null>(null)
export const fileBrowserStates = writable<Map<FileBrowserWorkspaceIdentity, FileBrowserWorkspaceState>>(new Map())

let nextFileRevealRequestId = 0

export function requestFileReveal(
  path: string,
  workspaceIdentity: FileBrowserWorkspaceIdentity | null = null,
): void {
  pendingFileReveal.set({
    requestId: ++nextFileRevealRequestId,
    workspaceIdentity,
    path,
  })
}
