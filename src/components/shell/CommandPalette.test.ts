import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import type { TaskDetail, AgentSession, Project } from '../../lib/types'
import { matchesSearch, sortTasks, filterActiveTasks, navigateToTask } from '../../lib/commandPalette'
import { activeProjectId, currentView, selectedTaskId, pendingTask } from '../../lib/stores'

function makeProject(overrides: Partial<Project> & { id: string; name: string }): Project {
  return {
    path: '/tmp/test',
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function makeTask(overrides: Partial<TaskDetail> & { id: string }): TaskDetail {
  return {
    prompt: 'Test task',
    promptPreview: 'Test task',
    status: 'doing',
    title: 'Test task',
    titleSource: null,
    titleGeneratedAt: null,
    agent: null,
    permissionMode: null,
    worktreeSource: null,
    worktreeBranch: null,
    sourceTicketUrl: null,
    dependsOn: [],
    projectId: 'P-1',
    createdAt: 1000,
    updatedAt: 1000,
    labels: [],
    ...overrides,
  }
}

function makeSession(taskId: string, status: string): AgentSession {
  return {
    id: `session-${taskId}`,
    ticket_id: taskId,
    opencode_session_id: null,
    stage: 'implementation',
    status,
    checkpoint_data: null,
    pty_instance_id: null,
    error_message: null,
    created_at: 1000,
    updated_at: 1000,
    provider: 'claude-code',
    claude_session_id: null,
    pi_session_id: null,
    grok_session_id: null,
  }
}

describe('CommandPalette sorting', () => {
  it('sorts attention tasks (paused) before active tasks', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'doing', updatedAt: 100 }),
      makeTask({ id: 'T-2', status: 'doing', updatedAt: 200 }),
    ]
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession('T-1', 'running')],
      ['T-2', makeSession('T-2', 'paused')],
    ])

    const sorted = sortTasks(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-2', 'T-1'])
  })

  it('sorts attention tasks (interrupted) before active tasks', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'doing', updatedAt: 300 }),
      makeTask({ id: 'T-2', status: 'doing', updatedAt: 100 }),
    ]
    const sessions = new Map<string, AgentSession>([
      ['T-1', makeSession('T-1', 'completed')],
      ['T-2', makeSession('T-2', 'interrupted')],
    ])

    const sorted = sortTasks(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-2', 'T-1'])
  })

  it('sorts active (doing) before backlog before done', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done', updatedAt: 300 }),
      makeTask({ id: 'T-2', status: 'backlog', updatedAt: 200 }),
      makeTask({ id: 'T-3', status: 'doing', updatedAt: 100 }),
    ]
    const sessions = new Map<string, AgentSession>()

    const sorted = sortTasks(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-3', 'T-2', 'T-1'])
  })

  it('sorts by updated_at DESC within same priority', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'doing', updatedAt: 100 }),
      makeTask({ id: 'T-2', status: 'doing', updatedAt: 300 }),
      makeTask({ id: 'T-3', status: 'doing', updatedAt: 200 }),
    ]
    const sessions = new Map<string, AgentSession>()

    const sorted = sortTasks(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual(['T-2', 'T-3', 'T-1'])
  })

  it('handles full priority ordering: attention > doing > backlog > done', () => {
    const tasks = [
      makeTask({ id: 'T-done', status: 'done', updatedAt: 500 }),
      makeTask({ id: 'T-backlog', status: 'backlog', updatedAt: 400 }),
      makeTask({ id: 'T-doing', status: 'doing', updatedAt: 300 }),
      makeTask({ id: 'T-paused', status: 'doing', updatedAt: 200 }),
      makeTask({ id: 'T-interrupted', status: 'doing', updatedAt: 100 }),
    ]
    const sessions = new Map<string, AgentSession>([
      ['T-paused', makeSession('T-paused', 'paused')],
      ['T-interrupted', makeSession('T-interrupted', 'interrupted')],
      ['T-doing', makeSession('T-doing', 'running')],
    ])

    const sorted = sortTasks(tasks, sessions)
    expect(sorted.map(t => t.id)).toEqual([
      'T-paused',       // attention (paused), updated_at 200
      'T-interrupted',  // attention (interrupted), updated_at 100
      'T-doing',        // doing (running session), updated_at 300
      'T-backlog',      // backlog, updated_at 400
      'T-done',         // done, updated_at 500
    ])
  })
})

describe('CommandPalette filterActiveTasks', () => {
  it('excludes tasks with status done', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'done' }),
      makeTask({ id: 'T-3', status: 'backlog' }),
      makeTask({ id: 'T-4', status: 'done' }),
    ]
    const result = filterActiveTasks(tasks)
    expect(result.map(t => t.id)).toEqual(['T-1', 'T-3'])
  })

  it('returns all tasks when none are done', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'doing' }),
      makeTask({ id: 'T-2', status: 'backlog' }),
    ]
    const result = filterActiveTasks(tasks)
    expect(result.map(t => t.id)).toEqual(['T-1', 'T-2'])
  })

  it('returns empty array when all tasks are done', () => {
    const tasks = [
      makeTask({ id: 'T-1', status: 'done' }),
      makeTask({ id: 'T-2', status: 'done' }),
    ]
    const result = filterActiveTasks(tasks)
    expect(result).toEqual([])
  })
})

describe('CommandPalette search filtering', () => {
  it('matches by task ID', () => {
    const task = makeTask({ id: 'T-42', prompt: 'Something' })
    expect(matchesSearch(task, 't-42')).toBe(true)
    expect(matchesSearch(task, 'T-99')).toBe(false)
  })

  it('matches by title', () => {
    const task = makeTask({ id: 'T-1', prompt: 'Fix the login bug' })
    expect(matchesSearch(task, 'login')).toBe(true)
    expect(matchesSearch(task, 'signup')).toBe(false)
  })

  it('returns all tasks when query is empty', () => {
    const task = makeTask({ id: 'T-1' })
    expect(matchesSearch(task, '')).toBe(true)
  })

  it('matches by project name when projectMap is provided', () => {
    const task = makeTask({ id: 'T-1', projectId: 'P-1' })
    const projectMap = new Map([['P-1', makeProject({ id: 'P-1', name: 'My Frontend App' })]])
    expect(matchesSearch(task, 'frontend', projectMap)).toBe(true)
    expect(matchesSearch(task, 'backend', projectMap)).toBe(false)
  })

  it('still matches other fields when projectMap is provided', () => {
    const task = makeTask({ id: 'T-42', prompt: 'Fix login', projectId: 'P-1' })
    const projectMap = new Map([['P-1', makeProject({ id: 'P-1', name: 'My App' })]])
    expect(matchesSearch(task, 't-42', projectMap)).toBe(true)
    expect(matchesSearch(task, 'login', projectMap)).toBe(true)
    expect(matchesSearch(task, 'my app', projectMap)).toBe(true)
  })

})

describe('navigateToTask', () => {
  beforeEach(() => {
    activeProjectId.set(null)
    currentView.set('board')
    selectedTaskId.set(null)
    pendingTask.set(null)
  })

  it('sets the pending Task when switching projects', () => {
    activeProjectId.set('P-1')
    const task = makeTask({ id: 'T-new', projectId: 'P-2' })

    navigateToTask(task)

    expect(get(activeProjectId)).toBe('P-2')
    expect(get(selectedTaskId)).toBe('T-new')
    expect(get(currentView)).toBe('board')
    expect(get(pendingTask)).toBe(task)
  })

  it('does not set a pending Task for the active project', () => {
    activeProjectId.set('P-1')
    const task = makeTask({ id: 'T-2', projectId: 'P-1' })

    navigateToTask(task)

    expect(get(activeProjectId)).toBe('P-1')
    expect(get(selectedTaskId)).toBe('T-2')
    expect(get(pendingTask)).toBeNull()
  })

  it('returns to the board', () => {
    activeProjectId.set('P-1')
    currentView.set('global_settings')

    navigateToTask(makeTask({ id: 'T-1', projectId: 'P-1' }))

    expect(get(currentView)).toBe('board')
  })
})
