import { get } from 'svelte/store'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  describeCompletionLoss,
  requestTerminalTaskConfirmation,
  resolveTerminalTaskConfirmation,
  terminalTaskConfirmationRequest,
} from './terminalTaskConfirmation'
import type { GitStatusSummary } from './types'

const cleanStatus: GitStatusSummary = {
  has_remote: true,
  remote_ahead: 0,
  remote_behind: 0,
  local_commits: 2,
  uncommitted_files: 0,
  insertions: 0,
  deletions: 0,
  untracked_files: 0,
  untracked_insertions: 0,
}

describe('describeCompletionLoss', () => {
  it('reports no loss when everything is committed and pushed', () => {
    expect(describeCompletionLoss(cleanStatus, null)).toEqual({ discardedFiles: 0, lostCommits: 0 })
  })

  it('counts uncommitted and untracked files as discarded', () => {
    const status = { ...cleanStatus, uncommitted_files: 2, untracked_files: 3 }
    expect(describeCompletionLoss(status, null).discardedFiles).toBe(5)
  })

  it('counts commits on a branch that was never pushed as lost', () => {
    const status = { ...cleanStatus, has_remote: false, local_commits: 4 }
    expect(describeCompletionLoss(status, null).lostCommits).toBe(4)
  })

  it('keeps commits that are pushed but behind or ahead of their remote branch', () => {
    const status = { ...cleanStatus, remote_ahead: 3 }
    expect(describeCompletionLoss(status, null).lostCommits).toBe(0)
  })

  it('keeps never-pushed commits when uncommitted changes make the branch survive', () => {
    const status = { ...cleanStatus, has_remote: false, local_commits: 4, untracked_files: 1 }
    expect(describeCompletionLoss(status, null)).toEqual({ discardedFiles: 1, lostCommits: 0 })
  })

  it('keeps commits on a branch the task did not create', () => {
    const status = { ...cleanStatus, has_remote: false, local_commits: 4 }
    expect(describeCompletionLoss(status, 'existingBranch').lostCommits).toBe(0)
  })
})

describe('requestTerminalTaskConfirmation', () => {
  beforeEach(() => {
    resolveTerminalTaskConfirmation(false)
  })

  it('opens a request and resolves with the answer', async () => {
    const answer = requestTerminalTaskConfirmation('Complete', 'T-1')
    expect(get(terminalTaskConfirmationRequest)).toMatchObject({ action: 'Complete', taskId: 'T-1' })

    resolveTerminalTaskConfirmation(true)

    await expect(answer).resolves.toBe(true)
    expect(get(terminalTaskConfirmationRequest)).toBeNull()
  })

  it('cancels the pending request when a second one opens', async () => {
    const first = requestTerminalTaskConfirmation('Complete', 'T-1')
    const second = requestTerminalTaskConfirmation('Delete', 'T-2')

    await expect(first).resolves.toBe(false)
    expect(get(terminalTaskConfirmationRequest)).toMatchObject({ action: 'Delete', taskId: 'T-2' })

    resolveTerminalTaskConfirmation(true)
    await expect(second).resolves.toBe(true)
  })
})
