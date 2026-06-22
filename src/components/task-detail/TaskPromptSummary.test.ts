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
  depends_on: [],
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

describe('TaskPromptSummary', () => {
  it('renders initial prompt and handoff notes', () => {
    render(TaskPromptSummary, { props: { task: baseTask } })
    expect(screen.getByText('Implement auth middleware')).toBeTruthy()
    expect(screen.getByText('Handoff Notes')).toBeTruthy()
    expect(screen.getByText('Implemented JWT auth')).toBeTruthy()
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
