import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import TaskPromptSummary from './TaskPromptSummary.svelte'
import type { Task } from '../../lib/types'

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  prompt: 'Build the auth middleware implementation with JWT support',
  title: null,
  summary: 'Implemented JWT auth',
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  depends_on: [],
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('TaskPromptSummary', () => {
  it('collapses the initial prompt by default while still rendering handoff notes', () => {
    render(TaskPromptSummary, { props: { task: baseTask } })
    // Initial Prompt header and reveal control are present, but the text is not.
    expect(screen.getByText('Initial Prompt')).toBeTruthy()
    expect(screen.getByRole('button', { name: /show initial prompt/i })).toBeTruthy()
    expect(screen.queryByText('Implement auth middleware')).toBeNull()
    // Handoff Notes behavior is unchanged.
    expect(screen.getByText('Handoff Notes')).toBeTruthy()
    expect(screen.getByText('Implemented JWT auth')).toBeTruthy()
  })

  it('reveals and hides the initial prompt text when the toggle is clicked', async () => {
    render(TaskPromptSummary, { props: { task: baseTask } })
    expect(screen.queryByText('Implement auth middleware')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: /show initial prompt/i }))
    expect(screen.getByText('Implement auth middleware')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: /hide initial prompt/i }))
    expect(screen.queryByText('Implement auth middleware')).toBeNull()
  })

  it('hides persisted image reference definitions from the initial prompt once revealed', async () => {
    render(TaskPromptSummary, {
      props: {
        task: {
          ...baseTask,
          initial_prompt: 'Inspect [image#1] carefully\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
        },
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /show initial prompt/i }))
    const promptContent = screen.getByRole('region', { name: 'Initial Prompt content' })
    expect(promptContent.textContent).toBe('Inspect [image#1] carefully')
    expect(promptContent.textContent).not.toContain('data:image/png;base64')
  })

  it('renders handoff notes fallback when summary is empty', () => {
    render(TaskPromptSummary, { props: { task: { ...baseTask, summary: null } } })
    expect(screen.getByText(/no handoff notes yet/i)).toBeTruthy()
  })

  it('shows an Edit prompt button for backlog tasks when onEditPrompt is provided', () => {
    render(TaskPromptSummary, { props: { task: baseTask, onEditPrompt: vi.fn() } })
    expect(screen.getByRole('button', { name: 'Edit prompt' })).toBeTruthy()
  })

  it('does not show Edit prompt when onEditPrompt is not provided', () => {
    render(TaskPromptSummary, { props: { task: baseTask } })
    expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull()
  })

  it('does not show Edit prompt for doing tasks (prompt already injected)', () => {
    render(TaskPromptSummary, { props: { task: { ...baseTask, status: 'doing' }, onEditPrompt: vi.fn() } })
    expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull()
  })

  it('does not show Edit prompt for done tasks', () => {
    render(TaskPromptSummary, { props: { task: { ...baseTask, status: 'done' }, onEditPrompt: vi.fn() } })
    expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull()
  })

  it('calls onEditPrompt when the Edit prompt button is clicked', async () => {
    const onEditPrompt = vi.fn()
    render(TaskPromptSummary, { props: { task: baseTask, onEditPrompt } })
    await fireEvent.click(screen.getByRole('button', { name: 'Edit prompt' }))
    expect(onEditPrompt).toHaveBeenCalled()
  })
})
