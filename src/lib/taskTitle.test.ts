import { describe, expect, it } from 'vitest'
import { getTaskDisplayTitle, getTaskTitle } from './taskTitle'
import type { Task, TaskLabel } from './types'

describe('getTaskTitle', () => {
  const baseTask = {
    id: 'T-123',
    status: 'backlog' as const,
    agent: null,
    title: null,
    title_source: null,
    title_generated_at: null,
    summary: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    handoff_notes_enabled: true,
    depends_on: [],
    project_id: null,
    created_at: 0,
    updated_at: 0
  }

  it('uses first line of initial_prompt', () => {
    const task: Task = { ...baseTask, initial_prompt: 'Fix the bug\nIt is broken', prompt: null }
    expect(getTaskTitle(task)).toBe('Fix the bug')
  })

  it('skips empty lines in initial_prompt', () => {
    const task: Task = { ...baseTask, initial_prompt: '\n  \n\nFix the bug', prompt: null }
    expect(getTaskTitle(task)).toBe('Fix the bug')
  })

  it('falls back to prompt if initial_prompt is empty', () => {
    const task: Task = { ...baseTask, initial_prompt: '', prompt: 'Second prompt' }
    expect(getTaskTitle(task)).toBe('Second prompt')
  })

  it('falls back to prompt if initial_prompt is only whitespace', () => {
    const task: Task = { ...baseTask, initial_prompt: '   \n  ', prompt: 'Fallback prompt' }
    expect(getTaskTitle(task)).toBe('Fallback prompt')
  })

  it('falls back to id if both are empty', () => {
    const task: Task = { ...baseTask, initial_prompt: '', prompt: '' }
    expect(getTaskTitle(task)).toBe('T-123')
  })

  it('falls back to id if both are whitespace', () => {
    const task: Task = { ...baseTask, initial_prompt: '  ', prompt: '\n \n' }
    expect(getTaskTitle(task)).toBe('T-123')
  })

  it('works with carriage returns', () => {
    const task: Task = { ...baseTask, initial_prompt: '\r\n\r\nHello\r\nWorld', prompt: null }
    expect(getTaskTitle(task)).toBe('Hello')
  })

  it('prefers an explicit title over the prompt-derived title', () => {
    const task: Task = { ...baseTask, initial_prompt: 'Long prompt text', prompt: 'Other', title: 'My Title' }
    expect(getTaskTitle(task)).toBe('My Title')
  })

  it('trims an explicit title', () => {
    const task: Task = { ...baseTask, initial_prompt: 'Prompt', prompt: null, title: '  Padded Title  ' }
    expect(getTaskTitle(task)).toBe('Padded Title')
  })

  it('falls back to the prompt-derived title when title is null', () => {
    const task: Task = { ...baseTask, initial_prompt: 'Derived from prompt', prompt: null, title: null }
    expect(getTaskTitle(task)).toBe('Derived from prompt')
  })

  it('ignores a whitespace-only title and falls back to the prompt-derived title', () => {
    const task: Task = { ...baseTask, initial_prompt: 'Derived', prompt: null, title: '   ' }
    expect(getTaskTitle(task)).toBe('Derived')
  })
})

describe('getTaskDisplayTitle', () => {
  const baseTask = {
    id: 'T-123',
    status: 'backlog' as const,
    initial_prompt: 'Extract shared validation logic',
    prompt: null,
    agent: null,
    title: null,
    title_source: null,
    title_generated_at: null,
    summary: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    handoff_notes_enabled: true,
    depends_on: [],
    project_id: null,
    created_at: 0,
    updated_at: 0
  }

  function labelled(...names: string[]): TaskLabel[] {
    return names.map((name, index) => ({ id: index + 1, project_id: 'P-1', name }))
  }

  function taskWithLabels(task: Partial<Task>, labels: TaskLabel[]): Task {
    return { ...baseTask, ...task, labels } as Task
  }

  it('prefixes a prompt-derived title when the task is labelled cleanup', () => {
    const task = taskWithLabels({}, labelled('cleanup'))
    expect(getTaskDisplayTitle(task)).toBe('[CLEANUP] Extract shared validation logic')
  })

  it('prefixes a generated title so cleanup tasks keep the prefix after an agent runs', () => {
    const task = taskWithLabels(
      { title: 'Dedupe form validation', title_source: 'generated' },
      labelled('cleanup')
    )
    expect(getTaskDisplayTitle(task)).toBe('[CLEANUP] Dedupe form validation')
  })

  it('prefixes a manually renamed title', () => {
    const task = taskWithLabels({ title: 'My own title', title_source: 'manual' }, labelled('cleanup'))
    expect(getTaskDisplayTitle(task)).toBe('[CLEANUP] My own title')
  })

  it('matches the cleanup label case-insensitively alongside other labels', () => {
    const task = taskWithLabels({}, labelled('tests', 'Cleanup'))
    expect(getTaskDisplayTitle(task)).toBe('[CLEANUP] Extract shared validation logic')
  })

  it('leaves a task without the cleanup label unprefixed', () => {
    const task = taskWithLabels({ initial_prompt: 'Fix the login bug' }, labelled('bug'))
    expect(getTaskDisplayTitle(task)).toBe('Fix the login bug')
  })

  it('leaves a task with no labels unprefixed', () => {
    const task = { ...baseTask } as Task
    expect(getTaskDisplayTitle(task)).toBe('Extract shared validation logic')
  })

  it('does not double-prefix a title that already starts with the prefix', () => {
    const task = taskWithLabels({ initial_prompt: '[CLEANUP] Drop unused imports' }, labelled('cleanup'))
    expect(getTaskDisplayTitle(task)).toBe('[CLEANUP] Drop unused imports')
  })
})
