import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { getAppShortcutHelpLabel } from '../../lib/appShortcutDefinitions'
import type { PullRequestInfo, Task } from '../../lib/types'

Element.prototype.scrollIntoView = vi.fn()

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    initial_prompt: 'Test task',
    status: 'backlog',
    prompt: null,
    title: null,
    title_source: null,
    title_generated_at: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    source_ticket_url: null,
    depends_on: [],
    project_id: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function makePullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    pr_number: 42,
    ticket_id: 'T-100',
    repo_owner: 'owner',
    repo_name: 'repo',
    title: 'Ready PR',
    url: 'https://github.com/owner/repo/pull/42',
    state: 'open',
    head_sha: 'abc123',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'approved',
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
    created_at: 1000,
    updated_at: 1000,
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
    merge_methods_policy_known: true,
    allowed_merge_methods: '["squash","rebase"]',
    default_merge_method: 'squash',
    ...overrides,
  }
}

describe('ActionPalette component', () => {
  it('does not select Run app first when CMD+K opens the palette', async () => {
    const { default: ActionPalette } = await import('./ActionPalette.svelte')
    const onExecute = vi.fn()

    render(ActionPalette, {
      props: {
        task: makeTask({ id: 'T-100', status: 'doing' }),
        customActions: [{
          id: 'custom-1',
          name: 'Custom Action',
          prompt: 'Do custom work',
          builtin: false,
          enabled: true,
        }],
        taskPrs: [],
        canRunApp: true,
        onClose: vi.fn(),
        onExecute,
      },
    })

    const options = screen.getAllByRole('option')
    expect(options[0].textContent).not.toContain('Run app')
    expect(options.findIndex(option => option.textContent?.includes('Run app'))).toBeGreaterThan(0)

    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' })

    expect(onExecute).not.toHaveBeenCalledWith('run-app')
  })

  it('preserves keyboard selection when available actions reorder', async () => {
    const { default: ActionPalette } = await import('./ActionPalette.svelte')
    const onClose = vi.fn()
    const onExecute = vi.fn()
    const task = makeTask({ id: 'T-100', status: 'backlog' })

    const { rerender } = render(ActionPalette, {
      props: {
        task,
        taskPrs: [],
        onClose,
        onExecute,
      },
    })

    const dialog = screen.getByRole('dialog')
    const actionOptions = screen.getAllByRole('option')
    const searchTasksLabel = getAppShortcutHelpLabel('search-tasks') ?? 'search-tasks'
    const searchTasksIndex = actionOptions.findIndex(option => option.textContent?.includes(searchTasksLabel))

    expect(searchTasksIndex).toBeGreaterThan(0)

    for (let i = 0; i < searchTasksIndex; i += 1) {
      await fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    }

    await rerender({
      task: makeTask({ id: 'T-100', status: 'done' }),
      taskPrs: [],
      onClose,
      onExecute,
    })

    await fireEvent.keyDown(dialog, { key: 'Enter' })

    expect(onExecute).toHaveBeenCalledWith('search-tasks')
  })

  it('links keyboard movement to option ids and clears the active descendant for an empty search', async () => {
    const { default: ActionPalette } = await import('./ActionPalette.svelte')
    render(ActionPalette, {
      props: {
        task: makeTask({ id: 'T-100', status: 'backlog' }),
        taskPrs: [],
        onClose: vi.fn(),
        onExecute: vi.fn(),
      },
    })

    const input = screen.getByPlaceholderText('Type an action...')
    const dialog = screen.getByRole('dialog')
    const listbox = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')

    expect(listbox.id).not.toBe('')
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    expect(options.every(option => option.id !== '')).toBe(true)
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id)

    await fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id)

    await fireEvent.input(input, { target: { value: 'no such action anywhere' } })
    expect(screen.getByText(/no actions match/i)).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
  })

  it('uses each option as the mouse target without moving focus from the combobox', async () => {
    const { default: ActionPalette } = await import('./ActionPalette.svelte')
    const onExecute = vi.fn()
    render(ActionPalette, {
      props: {
        task: makeTask({ id: 'T-100', status: 'backlog' }),
        taskPrs: [],
        onClose: vi.fn(),
        onExecute,
      },
    })

    const input = screen.getByPlaceholderText('Type an action...')
    const option = screen.getByRole('option', { name: /start task/i })
    input.focus()

    expect(option.querySelector('button')).toBeNull()
    expect(await fireEvent.mouseDown(option)).toBe(false)
    expect(document.activeElement).toBe(input)
    await fireEvent.click(option)
    expect(onExecute).toHaveBeenCalledWith('start-task')
  })

  it('shows CMD+K as the toggle hint', async () => {
    const { default: ActionPalette } = await import('./ActionPalette.svelte')

    render(ActionPalette, {
      props: {
        task: makeTask({ id: 'T-100', status: 'backlog' }),
        taskPrs: [],
        onClose: vi.fn(),
        onExecute: vi.fn(),
      },
    })

    expect(screen.getByText('⌘K')).toBeTruthy()
    expect(screen.getByText('⌘⇧F')).toBeTruthy()
    expect(screen.getByText('⌘⇧P')).toBeTruthy()
  })

  it('shows allowed merge methods and confirms the selected method before execution', async () => {
    const { default: ActionPalette } = await import('./ActionPalette.svelte')
    const onExecute = vi.fn()

    render(ActionPalette, {
      props: {
        task: makeTask({ id: 'T-100', status: 'doing' }),
        taskPrs: [makePullRequest()],
        onClose: vi.fn(),
        onExecute,
      },
    })

    expect(screen.getByText('GitHub default')).toBeTruthy()
    const searchInput = screen.getByPlaceholderText('Type an action...')
    expect(document.activeElement).toBe(searchInput)

    await fireEvent.keyDown(searchInput, { key: 'Enter' })

    expect(onExecute).not.toHaveBeenCalled()
    expect(screen.getByText('Squash and merge PR #42?')).toBeTruthy()

    const confirmButton = screen.getByRole('button', { name: 'Confirm' })
    expect(document.activeElement).toBe(confirmButton)

    await fireEvent.keyDown(confirmButton, { key: 'Enter' })
    expect(onExecute).toHaveBeenCalledWith('merge-pr:squash', 'squash')
  })
})
