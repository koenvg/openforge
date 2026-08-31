import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import TaskInitialPrompt from './TaskInitialPrompt.svelte'
import { clearRenderedMarkdownCache, getRenderedMarkdownCacheStats } from '@openforge-app/plugin-sdk/markdown'
import type { TaskDetail } from '../../lib/types'

const baseTask: TaskDetail = {
  id: 'T-42',
  projectId: 'project-1',
  status: 'backlog',
  title: 'Implement auth middleware',
  prompt: 'Implement auth middleware',
  promptPreview: 'Implement auth middleware',
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

describe('TaskInitialPrompt', () => {
  it('shows the whole initial prompt without a second expander', () => {
    render(TaskInitialPrompt, {
      props: {
        task: {
          ...baseTask,
          prompt: 'Line one\nLine two\nLine three\nLine four',
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
          prompt: '# Release plan\n\nShip the **renderer**\nFourth line',
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
          prompt: '# Cached prompt',
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
          prompt: 'Inspect [image#1] carefully\nSecond line\nThird line\nFourth line\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
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
