import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Writable } from 'svelte/store'
import type { AgentSession, GitStatusSummary } from '../../lib/types'

vi.mock('../../lib/ipc', () => ({ getTaskGitStatus: vi.fn() }))
vi.mock('../../lib/stores', async () => {
  const { writable: w } = await import('svelte/store')
  return { activeSessions: w(new Map()) }
})

import TaskGitStatus from './TaskGitStatus.svelte'
import { getTaskGitStatus } from '../../lib/ipc'
import { activeSessions } from '../../lib/stores'

const mockGet = vi.mocked(getTaskGitStatus)
const sessions = activeSessions as unknown as Writable<Map<string, AgentSession>>

function summary(overrides: Partial<GitStatusSummary> = {}): GitStatusSummary {
  return {
    has_remote: true,
    remote_ahead: 2,
    remote_behind: 1,
    local_commits: 3,
    uncommitted_files: 38,
    insertions: 1607,
    deletions: 642,
    untracked_files: 3,
    untracked_insertions: 156,
    ...overrides,
  }
}

function setSession(status: string) {
  sessions.set(new Map([['T-1', { status } as AgentSession]]))
}

beforeEach(() => {
  vi.clearAllMocks()
  sessions.set(new Map())
  mockGet.mockResolvedValue(summary())
})

describe('TaskGitStatus', () => {
  it('shows remote ahead/behind, local commits, and uncommitted on mount', async () => {
    render(TaskGitStatus, { props: { taskId: 'T-1' } })

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('T-1'))
    expect(await screen.findByText('↑2')).toBeTruthy()
    expect(screen.getByText('↓1')).toBeTruthy()
    expect(screen.getByText('3 commits')).toBeTruthy()
    expect(screen.getByText('38 files')).toBeTruthy()
    expect(screen.getByText('+1607')).toBeTruthy()
    expect(screen.getByText('−642')).toBeTruthy()
  })

  it('shows "no remote" with the local commit count and uncommitted files when not pushed', async () => {
    mockGet.mockResolvedValue(summary({ has_remote: false, remote_ahead: 0, remote_behind: 0, local_commits: 1, uncommitted_files: 2, insertions: 2, deletions: 0 }))
    render(TaskGitStatus, { props: { taskId: 'T-1' } })

    expect(await screen.findByText('no remote')).toBeTruthy()
    expect(screen.getByText('1 commit')).toBeTruthy()
    expect(screen.getByText('2 files')).toBeTruthy()
    expect(screen.getByText('+2')).toBeTruthy()
    expect(screen.getByText('−0')).toBeTruthy()
  })

  it('shows "up to date" when pushed and in sync with the remote', async () => {
    mockGet.mockResolvedValue(summary({ has_remote: true, remote_ahead: 0, remote_behind: 0 }))
    render(TaskGitStatus, { props: { taskId: 'T-1' } })

    expect(await screen.findByText('up to date')).toBeTruthy()
  })

  it('shows "none" for commits, uncommitted, and untracked when nothing has changed', async () => {
    mockGet.mockResolvedValue(summary({ has_remote: true, remote_ahead: 0, remote_behind: 0, local_commits: 0, uncommitted_files: 0, insertions: 0, deletions: 0, untracked_files: 0, untracked_insertions: 0 }))
    render(TaskGitStatus, { props: { taskId: 'T-1' } })

    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    expect(await screen.findAllByText('none')).toHaveLength(3)
  })

  it('shows untracked files and their line count', async () => {
    render(TaskGitStatus, { props: { taskId: 'T-1' } })

    const untracked = await screen.findByLabelText('Untracked files')
    expect(untracked.textContent).toContain('3 files')
    expect(untracked.textContent).toContain('+156')
  })

  it('reports untracked new files even when no tracked file has changed', async () => {
    mockGet.mockResolvedValue(summary({ uncommitted_files: 0, insertions: 0, deletions: 0, untracked_files: 1, untracked_insertions: 12 }))
    render(TaskGitStatus, { props: { taskId: 'T-1' } })

    const untracked = await screen.findByLabelText('Untracked files')
    expect(untracked.textContent).toContain('1 file')
    expect(untracked.textContent).toContain('+12')
  })

  it('refetches when the refresh button is clicked', async () => {
    render(TaskGitStatus, { props: { taskId: 'T-1' } })
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1))

    await fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
  })

  it('refetches when the agent status changes', async () => {
    setSession('running')
    render(TaskGitStatus, { props: { taskId: 'T-1' } })
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1))

    setSession('completed')

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
  })
})
