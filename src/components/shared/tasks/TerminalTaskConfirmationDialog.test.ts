import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Writable } from 'svelte/store'
import TerminalTaskConfirmationDialog from './TerminalTaskConfirmationDialog.svelte'
import type { AgentSession, GitStatusSummary, TaskDetail } from '../../../lib/types'
import { activeSessions } from '../../../lib/stores'
import { activeTasks } from '../../../lib/tasksState'
import { getTaskGitStatus } from '../../../lib/ipc'
import {
  requestTerminalTaskConfirmation,
  resolveTerminalTaskConfirmation,
} from '../../../lib/terminalTaskConfirmation'

vi.mock('../../../lib/ipc', () => ({
  getTaskGitStatus: vi.fn(),
}))

vi.mock('../../../lib/tasksState', async (importOriginal) => {
  const { writable } = await import('svelte/store')
  return {
    ...await importOriginal<typeof import('../../../lib/tasksState')>(),
    activeTasks: writable<TaskDetail[]>([]),
  }
})

const tasks = activeTasks as Writable<TaskDetail[]>

const task: TaskDetail = {
  id: 'T-1',
  prompt: 'Fix the login page',
  promptPreview: 'Fix the login page',
  status: 'doing',
  projectId: 'project-1',
  createdAt: 1000,
  updatedAt: 2000,
  completedAt: null,
  title: 'Fix the login page',
  titleSource: null,
  titleGeneratedAt: null,
  agent: null,
  permissionMode: 'default',
  worktreeSource: null,
  worktreeBranch: null,
  sourceTicketUrl: null,
  dependsOn: [],
  labels: [],
}

const cleanStatus: GitStatusSummary = {
  has_remote: true,
  remote_ahead: 0,
  remote_behind: 0,
  local_commits: 1,
  uncommitted_files: 0,
  insertions: 0,
  deletions: 0,
  untracked_files: 0,
  untracked_insertions: 0,
}

function runningSession(): AgentSession {
  return { id: 'S-1', task_id: 'T-1', status: 'running', checkpoint_data: null } as unknown as AgentSession
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveTerminalTaskConfirmation(false)
  tasks.set([task])
  activeSessions.set(new Map())
  vi.mocked(getTaskGitStatus).mockResolvedValue(cleanStatus)
})

describe('TerminalTaskConfirmationDialog', () => {
  it('renders nothing until a confirmation is requested', () => {
    render(TerminalTaskConfirmationDialog)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('names the task, says nothing is lost, and confirms Complete', async () => {
    render(TerminalTaskConfirmationDialog)
    const answer = requestTerminalTaskConfirmation('Complete', 'T-1')

    expect(await screen.findByText('Complete “Fix the login page”?')).toBeTruthy()
    expect(await screen.findByText(/Nothing in the worktree would be lost/)).toBeTruthy()
    expect(screen.getByText(/openforge task completed/)).toBeTruthy()
    expect(getTaskGitStatus).toHaveBeenCalledWith('T-1')

    await fireEvent.click(screen.getByRole('button', { name: 'Complete task' }))

    await expect(answer).resolves.toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('focuses Cancel so a stray Enter does not complete the task', async () => {
    render(TerminalTaskConfirmationDialog)
    void requestTerminalTaskConfirmation('Complete', 'T-1')

    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(document.activeElement).toBe(cancel))
  })

  it('resolves false when cancelled', async () => {
    render(TerminalTaskConfirmationDialog)
    const answer = requestTerminalTaskConfirmation('Complete', 'T-1')

    await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await expect(answer).resolves.toBe(false)
  })

  it('warns about files that would be discarded and names the loss on the button', async () => {
    vi.mocked(getTaskGitStatus).mockResolvedValue({ ...cleanStatus, uncommitted_files: 2, untracked_files: 1 })
    render(TerminalTaskConfirmationDialog)
    void requestTerminalTaskConfirmation('Complete', 'T-1')

    expect(await screen.findByText('3 files have changes that aren’t committed. Completing deletes them.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Discard work and complete' })).toBeTruthy()
    expect(screen.queryByText(/Nothing in the worktree would be lost/)).toBeNull()
  })

  it('warns about commits that were never pushed', async () => {
    vi.mocked(getTaskGitStatus).mockResolvedValue({ ...cleanStatus, has_remote: false, local_commits: 1 })
    render(TerminalTaskConfirmationDialog)
    void requestTerminalTaskConfirmation('Complete', 'T-1')

    expect(await screen.findByText('1 commit on this branch was never pushed. Completing deletes the branch and the commit with it.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Discard work and complete' })).toBeTruthy()
  })

  it('warns that a running agent will be stopped', async () => {
    activeSessions.set(new Map([['T-1', runningSession()]]))
    render(TerminalTaskConfirmationDialog)
    void requestTerminalTaskConfirmation('Complete', 'T-1')

    expect(await screen.findByText('The agent is still working. Completing stops it.')).toBeTruthy()
  })

  it('says so when it cannot check the worktree', async () => {
    vi.mocked(getTaskGitStatus).mockRejectedValue(new Error('no worktree'))
    render(TerminalTaskConfirmationDialog)
    void requestTerminalTaskConfirmation('Complete', 'T-1')

    expect(await screen.findByText(/couldn’t check the worktree/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Complete task' }).hasAttribute('disabled')).toBe(false)
  })

  it('keeps the confirm button disabled while the worktree is being checked', async () => {
    vi.mocked(getTaskGitStatus).mockReturnValue(new Promise(() => {}))
    render(TerminalTaskConfirmationDialog)
    void requestTerminalTaskConfirmation('Complete', 'T-1')

    const confirm = await screen.findByRole('button', { name: 'Complete task' })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Checking the worktree/)).toBeTruthy()
  })

  it('explains that Delete keeps nothing and does not check the worktree', async () => {
    tasks.set([{ ...task, status: 'backlog' }])
    render(TerminalTaskConfirmationDialog)
    const answer = requestTerminalTaskConfirmation('Delete', 'T-1')

    expect(await screen.findByText('Delete “Fix the login page”?')).toBeTruthy()
    expect(screen.getByText(/deletes this backlog task permanently/)).toBeTruthy()
    expect(getTaskGitStatus).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await expect(answer).resolves.toBe(true)
  })
})
