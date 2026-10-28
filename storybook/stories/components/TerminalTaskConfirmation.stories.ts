import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import TerminalTaskConfirmationFrame from '../../shared/frames/TerminalTaskConfirmationFrame.svelte'
import { clearActiveTasks, installActiveTasks } from '../../../src/lib/tasksState'
import { activeSessions } from '../../../src/lib/stores'
import { terminalTaskConfirmationRequest } from '../../../src/lib/terminalTaskConfirmation'
import type { AgentSession, GitStatusSummary, TaskDetail } from '../../../src/lib/types'
import { createStoryStoreAdapter as seed } from '../../shared/environment/storyStoreAdapter'
import { createTask } from '../../shared/fixtures/appFixtures'

const clean: GitStatusSummary = { has_remote: true, remote_ahead: 0, remote_behind: 0, local_commits: 2, uncommitted_files: 0, insertions: 0, deletions: 0, untracked_files: 0, untracked_insertions: 0 }
const runningSession = { id: 'S-1', task_id: 'T-42', status: 'running', checkpoint_data: null } as unknown as AgentSession

function tasksAdapter(task: TaskDetail) {
  return {
    install: () => installActiveTasks('project-1', { tasks: [task], related: [] }),
    reset: () => installActiveTasks('project-1', { tasks: [task], related: [] }),
    dispose: () => clearActiveTasks('project-1'),
  }
}

function scenario(options: {
  status?: GitStatusSummary
  state?: 'checking' | 'failure'
  agentRunning?: boolean
  task?: TaskDetail
}): Story['parameters'] {
  return { openforge: {
    adapters: () => [
      tasksAdapter(options.task ?? createTask({ status: 'doing' })),
      seed(activeSessions, options.agentRunning ? new Map([['T-42', runningSession]]) : new Map()),
      seed(terminalTaskConfirmationRequest, null),
    ],
    desktop: {
      responses: { get_task_git_status: options.status ?? clean },
      deferred: options.state === 'checking' ? ['get_task_git_status'] : [],
      failures: options.state === 'failure' ? { get_task_git_status: 'The worktree is unavailable.' } : {},
    },
  } }
}

const meta = {
  title: 'Components/Task Completion Confirmation', component: TerminalTaskConfirmationFrame,
  args: { action: 'Complete', taskId: 'T-42', onAnswer: fn() },
} satisfies Meta<typeof TerminalTaskConfirmationFrame>
export default meta
type Story = StoryObj<typeof meta>

export const NothingLost: Story = {
  parameters: scenario({}),
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByText('Nothing in the worktree would be lost.')
    await waitFor(() => expect(canvasElement.ownerDocument.activeElement).toBe(body.getByRole('button', { name: 'Cancel' })))
    await userEvent.click(body.getByRole('button', { name: 'Complete task' }))
    await waitFor(() => expect(args.onAnswer).toHaveBeenCalledWith(true))
  },
}

export const UnsavedWork: Story = {
  parameters: scenario({ status: { ...clean, has_remote: false, local_commits: 3, uncommitted_files: 0, untracked_files: 0 } }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByText(/3 commits on this branch were never pushed/)
    await expect(body.getByRole('button', { name: 'Discard work and complete' })).toBeVisible()
  },
}

export const UncommittedFilesAndRunningAgent: Story = {
  parameters: scenario({ status: { ...clean, uncommitted_files: 4, untracked_files: 2 }, agentRunning: true }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByText(/6 files have changes that aren’t committed/)
    await expect(body.getByText('The agent is still working. Completing stops it.')).toBeVisible()
  },
}

export const Checking: Story = {
  parameters: scenario({ state: 'checking' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByText(/Checking the worktree/)
    await expect(body.getByRole('button', { name: 'Complete task' })).toBeDisabled()
  },
}

export const CheckFailed: Story = {
  parameters: scenario({ state: 'failure' }),
  play: async ({ canvasElement }) => {
    await within(canvasElement.ownerDocument.body).findByText(/couldn’t check the worktree/)
  },
}

export const DeleteBacklogTask: Story = {
  args: { action: 'Delete' },
  parameters: scenario({ task: createTask({ status: 'backlog' }) }),
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByText(/deletes this backlog task permanently/)
    await userEvent.click(body.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(args.onAnswer).toHaveBeenCalledWith(false))
  },
}
