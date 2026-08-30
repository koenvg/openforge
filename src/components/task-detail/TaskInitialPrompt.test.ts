import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import TaskInitialPrompt from './TaskInitialPrompt.svelte'
import { clearRenderedMarkdownCache, getRenderedMarkdownCacheStats } from '@openforge-app/plugin-sdk/markdown'
import type { Task } from '../../lib/types'

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  prompt: 'Build the auth middleware implementation with JWT support',
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
  updated_at: 2000,
}

describe('TaskInitialPrompt', () => {
  it('shows the whole initial prompt without a second expander', () => {
    render(TaskInitialPrompt, {
      props: {
        task: {
          ...baseTask,
          initial_prompt: 'Line one\nLine two\nLine three\nLine four',
        },
      },
    })

    const promptContent = screen.getByRole('region', { name: 'Initial Prompt content' })
    expect(promptContent.textContent).toContain('Line one')
    expect(promptContent.textContent).toContain('Line four')
    // The section header chevron is the only expander; it persists, this one did not.
    expect(screen.queryByRole('button', { name: /show (full|less) initial prompt/i })).toBeNull()
  })

  it('renders the initial prompt as Markdown', () => {
    render(TaskInitialPrompt, {
      props: {
        task: {
          ...baseTask,
          initial_prompt: '# Release plan\n\nShip the **renderer**\nFourth line',
        },
      },
    })

    const promptContent = screen.getByRole('region', { name: 'Initial Prompt content' })
    expect(screen.getByRole('heading', { name: 'Release plan' })).toBeTruthy()
    expect(promptContent.querySelector('strong')?.textContent).toBe('renderer')
    expect(promptContent.textContent).toContain('Fourth line')
  })
  it('reuses sanitized Markdown when the initial prompt is collapsed and reopened', async () => {
    clearRenderedMarkdownCache()
    render(TaskInitialPrompt, {
      props: {
        task: {
          ...baseTask,
          initial_prompt: '# Cached prompt',
        },
      },
    })

    expect(getRenderedMarkdownCacheStats()).toMatchObject({ hits: 0, misses: 1 })

    const toggle = screen.getByRole('button', { name: 'Initial Prompt' })
    await fireEvent.click(toggle)
    await fireEvent.click(toggle)

    expect(screen.getByRole('heading', { name: 'Cached prompt' })).toBeTruthy()
    expect(getRenderedMarkdownCacheStats()).toMatchObject({ hits: 1, misses: 1 })
  })

  it('hides persisted image reference definitions from the initial prompt', () => {
    render(TaskInitialPrompt, {
      props: {
        task: {
          ...baseTask,
          initial_prompt: 'Inspect [image#1] carefully\nSecond line\nThird line\nFourth line\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
        },
      },
    })

    const promptContent = screen.getByRole('region', { name: 'Initial Prompt content' })
    expect(promptContent.textContent).toContain('Inspect [image#1] carefully')
    expect(promptContent.textContent).toContain('Fourth line')
    expect(promptContent.textContent).not.toContain('data:image/png;base64')
  })

  it('shows an Edit prompt button for backlog tasks when onEditPrompt is provided', () => {
    render(TaskInitialPrompt, { props: { task: baseTask, onEditPrompt: vi.fn() } })
    expect(screen.getByRole('button', { name: 'Edit prompt' })).toBeTruthy()
  })

  it('does not show Edit prompt when onEditPrompt is not provided', () => {
    render(TaskInitialPrompt, { props: { task: baseTask } })
    expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull()
  })

  it('does not show Edit prompt for doing tasks (prompt already injected)', () => {
    render(TaskInitialPrompt, { props: { task: { ...baseTask, status: 'doing' }, onEditPrompt: vi.fn() } })
    expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull()
  })

  it('does not show Edit prompt for done tasks', () => {
    render(TaskInitialPrompt, { props: { task: { ...baseTask, status: 'done' }, onEditPrompt: vi.fn() } })
    expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull()
  })

  it('calls onEditPrompt when the Edit prompt button is clicked', async () => {
    const onEditPrompt = vi.fn()
    render(TaskInitialPrompt, { props: { task: baseTask, onEditPrompt } })
    await fireEvent.click(screen.getByRole('button', { name: 'Edit prompt' }))
    expect(onEditPrompt).toHaveBeenCalled()
  })
})
