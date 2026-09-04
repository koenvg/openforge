import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compile } from 'svelte/compiler'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import TaskListItem from './TaskListItem.svelte'
import type { TaskDetail, PullRequestInfo } from '../../lib/types'
import type { TaskState } from '../../lib/taskState'

vi.mock('../../lib/ipc', () => ({
  openUrl: vi.fn(),
  updateTaskTitle: vi.fn().mockResolvedValue(undefined),
}))

const baseTask: TaskDetail = {
  id: 'T-100',
  projectId: 'project-1',
  status: 'doing',
  title: 'Fix login bug',
  prompt: 'Fix login bug',
  promptPreview: 'Fix login bug',
  titleSource: null,
  titleGeneratedAt: null,
  agent: null,
  permissionMode: null,
  worktreeSource: null,
  worktreeBranch: null,
  sourceTicketUrl: null,
  dependsOn: [],
  labels: [],
  createdAt: 1000,
  updatedAt: 2000,
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

  it('renders the canonical Task title', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.getByText('Fix login bug')).toBeTruthy()
  })

  it('shows a Rename task button', () => {
    render(TaskListItem, { props: baseProps })
    expect(screen.getByRole('button', { name: 'Rename task' })).toBeTruthy()
  })

  it('keeps forwarded action icon classes global in compiled CSS', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'TaskListItem.svelte'), 'utf8')
    const { css, warnings } = compile(source, { filename: 'TaskListItem.svelte', generate: 'client' })
    const forwardedClasses = ['task-item-action', 'task-item-action--quiet', 'task-item-action--muted']

    expect(warnings.filter((warning) => warning.code === 'css_unused_selector')).toEqual([])
    for (const className of forwardedClasses) {
      expect(css?.code, className).toContain(`.${className}`)
      expect(css?.code, className).not.toContain(`.${className}.svelte-`)
    }

    render(TaskListItem, { props: baseProps })
    const renameIcon = screen.getByRole('button', { name: 'Rename task' }).querySelector('svg')
    const moreActionsIcon = screen.getByRole('button', { name: 'More actions for T-100' }).querySelector('svg')

    expect(renameIcon?.classList.contains('task-item-action')).toBe(true)
    expect(renameIcon?.classList.contains('task-item-action--quiet')).toBe(true)
    expect(moreActionsIcon?.classList.contains('task-item-action')).toBe(true)
    expect(moreActionsIcon?.classList.contains('task-item-action--muted')).toBe(true)
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

  it('renders only the first line of the prompt when the title is empty', () => {
    const task = { ...baseTask, title: '', prompt: 'First line\nSecond line' }
    render(TaskListItem, { props: { ...baseProps, task } })
    expect(screen.getByText('First line')).toBeTruthy()
    expect(screen.queryByText('Second line')).toBeNull()
  })

  it('truncates title to 80 chars with ellipsis', () => {
    const longTitle = 'A'.repeat(90)
    const task = { ...baseTask, title: longTitle }
    render(TaskListItem, { props: { ...baseProps, task } })
    expect(screen.getByText('A'.repeat(80) + '...')).toBeTruthy()
  })

  it('shows unread Agent output without replacing workflow status or reason text', () => {
    render(TaskListItem, {
      props: {
        ...baseProps,
        state: 'review-pending',
        reasonText: 'Waiting on code review.',
        hasUnreadAgentOutput: true,
      },
    })

    expect(screen.getByText('Unread agent output')).toBeTruthy()
    expect(screen.getByText('Review Pending')).toBeTruthy()
    expect(screen.getByText('Waiting on code review.')).toBeTruthy()
    expect(screen.getByLabelText('Unread agent output')).toBeTruthy()
  })

  it('hides the unread Agent output label after acknowledgement', () => {
    render(TaskListItem, { props: { ...baseProps, hasUnreadAgentOutput: false } })

    expect(screen.queryByText('Unread agent output')).toBeNull()
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

  it('renders compact card details with visible label chips', () => {
    const task = {
      ...baseTask,
      dependsOn: ['T-1'],
      labels: [
        { id: 1, projectId: 'project-1', name: 'frontend' },
        { id: 2, projectId: 'project-1', name: 'UX' },
        { id: 3, projectId: 'project-1', name: 'backend' },
        { id: 4, projectId: 'project-1', name: 'blocked' },
      ],
    } satisfies TaskDetail
    render(TaskListItem, { props: { ...baseProps, task, showLabels: true, dependencyHint: 'Waiting on 1 dep' } })
    expect(screen.getByText('1 dep')).toBeTruthy()
    expect(screen.getByText('4 labels')).toBeTruthy()
    const labelChips = screen.getByLabelText('Task labels')
    expect(within(labelChips).getByText('frontend')).toBeTruthy()
    expect(within(labelChips).getByText('UX')).toBeTruthy()
    expect(within(labelChips).getByText('backend')).toBeTruthy()
    expect(within(labelChips).getByText('+1')).toBeTruthy()
    expect(screen.getByLabelText('Labels: frontend, UX, backend, blocked')).toBeTruthy()
    expect(screen.queryByText(/frontend \+3/)).toBeNull()
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

  it('falls back to the prompt when the title is empty', () => {
    const task = { ...baseTask, title: '', prompt: 'Fallback title' }
    render(TaskListItem, { props: { ...baseProps, task } })
    expect(screen.getByText('Fallback title')).toBeTruthy()
  })
})
