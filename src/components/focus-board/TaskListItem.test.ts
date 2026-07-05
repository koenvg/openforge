import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import TaskListItem from './TaskListItem.svelte'
import type { Task, PullRequestInfo } from '../../lib/types'
import type { TaskState } from '../../lib/taskState'

vi.mock('../../lib/ipc', () => ({
  openUrl: vi.fn(),
  updateTaskTitle: vi.fn().mockResolvedValue(undefined),
}))

const baseTask: Task = {
  id: 'T-100',
  initial_prompt: 'Fix login bug',
  status: 'doing',
  prompt: null,
  title: null,
  title_source: null,
  title_generated_at: null,
  summary: null,
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  handoff_notes_enabled: true,
  depends_on: [],
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

const basePr: PullRequestInfo = {
  id: 99,
  pr_number: 99,
  ticket_id: 'T-100',
  repo_owner: 'owner',
  repo_name: 'repo',
  title: 'Fix login',
  url: 'https://github.com/owner/repo/pull/99',
  state: 'open',
  head_sha: 'abc123',
  ci_status: null,
  ci_check_runs: null,
  review_status: null,
  mergeable: null,
  mergeable_state: null,
  merged_at: null,
  created_at: 1000,
  updated_at: 2000,
  draft: false,
  is_queued: false,
  unaddressed_comment_count: 0,
    merge_readiness_status: null,
    merge_readiness_action: null,
    merge_readiness_blockers: null,
    merge_readiness_warnings: null,
    readiness_source_head_sha: null,
    merge_group_sha: null,
    required_checks_policy_known: null,
    required_reviews_policy_known: null,
    merge_queue_required: null,
    merge_queue_state: null,
    readiness_updated_at: null,
}

const baseProps = {
  task: baseTask,
  state: 'active' as TaskState,
  session: null,
  pullRequests: [] as PullRequestInfo[],
  reasonText: 'Agent is running.',
  isSelected: false,
  isFocused: false,
  isMerging: false,
  onSelect: vi.fn(),
  onContextMenu: vi.fn(),
}

describe('TaskListItem', () => {
  it('renders task ID', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.getByText('T-100')).toBeTruthy()
  })

  it('renders title from initial_prompt', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.getByText('Fix login bug')).toBeTruthy()
  })

  it('shows a Rename task button', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.getByRole('button', { name: 'Rename task' })).toBeTruthy()
  })

  it('clicking Rename reveals a title input pre-filled with the title without selecting the card', async () => {
    const onSelect = vi.fn()
    render(TaskListItem, { props: { ...baseProps, onSelect } })
    await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
    const input = screen.getByRole('textbox', { name: 'Task title' }) as HTMLInputElement
    expect(input.value).toBe('Fix login bug')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('saves the renamed title on Enter and refreshes', async () => {
    const { updateTaskTitle } = await import('../../lib/ipc')
    vi.mocked(updateTaskTitle).mockClear()
    const onTaskUpdated = vi.fn()
    render(TaskListItem, { props: { ...baseProps, onTaskUpdated } })
    await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
    const input = screen.getByRole('textbox', { name: 'Task title' })
    await fireEvent.input(input, { target: { value: 'Renamed from board' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(updateTaskTitle).toHaveBeenCalledWith('T-100', 'Renamed from board')
    })
    expect(onTaskUpdated).toHaveBeenCalled()
  })

  it('Escape cancels renaming on the card without saving', async () => {
    const { updateTaskTitle } = await import('../../lib/ipc')
    vi.mocked(updateTaskTitle).mockClear()
    render(TaskListItem, { props: baseProps })
    await fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
    const input = screen.getByRole('textbox', { name: 'Task title' })
    await fireEvent.input(input, { target: { value: 'Discard' } })
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(updateTaskTitle).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
  })

  it('renders only first line of initial_prompt as title', () => {
    const task = { ...baseTask, initial_prompt: 'First line\nSecond line' }
    render(TaskListItem, { props: { ...baseProps, task } })
    expect(screen.getByText('First line')).toBeTruthy()
    expect(screen.queryByText('Second line')).toBeNull()
  })

  it('truncates title to 80 chars with ellipsis', () => {
    const longTitle = 'A'.repeat(90)
    const task = { ...baseTask, initial_prompt: longTitle }
    render(TaskListItem, { props: { ...baseProps, task } })
    expect(screen.getByText('A'.repeat(80) + '...')).toBeTruthy()
  })

  it('renders reasonText', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.getByText('Agent is running.')).toBeTruthy()
  })

  it('renders read-only dependency wait hint when provided', () => {
    render(TaskListItem, { props: { ...baseProps, dependencyHint: 'Waiting on 2 deps' } })
    expect(screen.getByText('Waiting on 2 deps')).toBeTruthy()
  })

  it('does not render dependency wait hint when omitted', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.queryByText(/Waiting on \d+ deps?/)).toBeNull()
  })

  it('summarizes card details into compact counts and label text', () => {
    const task = {
      ...baseTask,
      depends_on: ['T-1'],
      labels: [
        { id: 1, project_id: 'P-1', name: 'frontend', color: 'primary' },
        { id: 2, project_id: 'P-1', name: 'UX', color: 'secondary' },
      ],
    } as Task
    render(TaskListItem, { props: { ...baseProps, task, showLabels: true, dependencyHint: 'Waiting on 1 dep' } })
    expect(screen.getByText('1 dep')).toBeTruthy()
    expect(screen.getByText('2 labels')).toBeTruthy()
    expect(screen.getByText(/frontend \+1/)).toBeTruthy()
  })

  it('keeps the full reasonText available when selected', () => {
    render(TaskListItem, { props: { ...baseProps, isSelected: true, reasonText: 'A very long reason text that should be ellipsized' } })
    const item = document.querySelector('[data-vim-item]') as HTMLElement
    expect(item.getAttribute('data-selected')).toBe('true')
    expect(screen.getByText('A very long reason text that should be ellipsized')).toBeTruthy()
  })

  it('calls onSelect when clicked', async () => {
    const onSelect = vi.fn()
    render(TaskListItem, { props: { ...baseProps, onSelect } })
    const item = document.querySelector('[data-vim-item]') as HTMLElement
    await fireEvent.click(item)
    expect(onSelect).toHaveBeenCalled()
  })

  it('calls onSelect from keyboard activation', async () => {
    const onSelect = vi.fn()
    render(TaskListItem, { props: { ...baseProps, onSelect } })
    const item = document.querySelector('[data-vim-item]') as HTMLElement
    await fireEvent.keyDown(item, { key: 'Enter' })
    await fireEvent.keyDown(item, { key: ' ' })
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('calls onContextMenu on right-click', async () => {
    const onContextMenu = vi.fn()
    render(TaskListItem, { props: { ...baseProps, onContextMenu } })
    const item = document.querySelector('[data-vim-item]') as HTMLElement
    await fireEvent.contextMenu(item)
    expect(onContextMenu).toHaveBeenCalled()
  })

  it('sets data-selected attribute to "true" when isSelected is true', () => {
    render(TaskListItem, { props: { ...baseProps, isSelected: true } })
    const item = document.querySelector('[data-vim-item]') as HTMLElement
    expect(item.getAttribute('data-selected')).toBe('true')
  })

  it('does not set data-selected when isSelected is false', () => {
    render(TaskListItem, { props: { ...baseProps, isSelected: false } })
    const item = document.querySelector('[data-vim-item]') as HTMLElement
    expect(item.getAttribute('data-selected')).toBeNull()
  })

  it('sets data-focused when isFocused is true', () => {
    render(TaskListItem, { props: { ...baseProps, isFocused: true } })
    const item = document.querySelector('[data-vim-item]') as HTMLElement
    expect(item.getAttribute('data-focused')).toBe('true')
  })

  it('does not set data-focused when isFocused is false', () => {
    render(TaskListItem, { props: { ...baseProps, isFocused: false } })
    const item = document.querySelector('[data-vim-item]') as HTMLElement
    expect(item.getAttribute('data-focused')).toBeNull()
  })

  it('sets data-just-viewed to "true" when justViewed is true', () => {
    const { container } = render(TaskListItem, { props: { ...baseProps, justViewed: true } })
    const item = container.querySelector('[data-just-viewed="true"]')
    expect(item).not.toBeNull()
  })

  it('does not set data-just-viewed when justViewed is omitted', () => {
    const { container } = render(TaskListItem, { props: baseProps })
    expect(container.querySelector('[data-just-viewed]')).toBeNull()
  })

  it('renders PR chip showing PR number when pullRequests are given', () => {
    render(TaskListItem, { props: { ...baseProps, pullRequests: [basePr] } })
    expect(screen.getByText(/PR #99/)).toBeTruthy()
  })

  it('does not render PR chip when pullRequests is empty', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.queryByText(/PR #/)).toBeNull()
  })

  it('renders queued label for pr-queued state', () => {
    render(TaskListItem, { props: { ...baseProps, state: 'pr-queued' as TaskState } })
    expect(screen.getByText('Queued')).toBeTruthy()
  })

  it('renders "Merge Conflict" label for merge-conflict state', () => {
    render(TaskListItem, { props: { ...baseProps, state: 'merge-conflict' as TaskState } })
    expect(screen.getByText('Merge Conflict')).toBeTruthy()
  })

  it('with multiple PRs, shows the state-driving PR (open preferred over merged)', () => {
    const mergedPr: PullRequestInfo = { ...basePr, id: 7, state: 'merged', merged_at: 5000 }
    const openPr: PullRequestInfo = { ...basePr, id: 42, state: 'open' }
    render(TaskListItem, { props: { ...baseProps, pullRequests: [mergedPr, openPr] } })
    expect(screen.getByText(/PR #42/)).toBeTruthy()
    expect(screen.queryByText(/PR #7/)).toBeNull()
  })

  it('falls back to prompt if initial_prompt is empty', () => {
    const task = { ...baseTask, initial_prompt: '', prompt: 'Fallback title' }
    render(TaskListItem, { props: { ...baseProps, task } })
    expect(screen.getByText('Fallback title')).toBeTruthy()
  })
})
