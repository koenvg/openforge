import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FOCUS_STATES,
  filterTasks,
  taskMatchesTextFilter,
  getFilterCounts,
  loadFocusFilterStates,
  loadOutOfFocusTaskIds,
  saveFocusFilterStates,
  saveOutOfFocusTaskIds,
} from './boardFilters'
import type { TaskDetail } from './types'

const ipc = vi.hoisted(() => ({
  getProjectConfig: vi.fn(),
  setProjectConfig: vi.fn(),
}))

vi.mock('./ipc', () => ipc)

function task(id: string, status: TaskDetail['status'] = 'doing'): TaskDetail {
  return {
    id,
    prompt: id,
    promptPreview: id,
    status,
    title: id,
    titleSource: null,
    titleGeneratedAt: null,
    agent: null,
    permissionMode: null,
    worktreeSource: null,
    worktreeBranch: null,
    sourceTicketUrl: null,
    dependsOn: [],
    projectId: 'P-1',
    createdAt: 0,
    updatedAt: 0,
    labels: [],
  }
}

beforeEach(() => {
  ipc.getProjectConfig.mockReset()
  ipc.setProjectConfig.mockReset()
})

describe('plain-text Task filtering', () => {
  it('matches case-insensitive substrings across the Task title, prompt, and labels', () => {
    const candidate: TaskDetail = {
      ...task('T-1'),
      title: 'Authentication overhaul',
      prompt: 'Build the login flow with recovery codes',
      labels: [{ id: 1, projectId: 'P-1', name: 'Security' }],
    }

    expect(taskMatchesTextFilter(candidate, 'AUTH')).toBe(true)
    expect(taskMatchesTextFilter(candidate, 'login')).toBe(true)
    expect(taskMatchesTextFilter(candidate, 'recovery')).toBe(true)
    expect(taskMatchesTextFilter(candidate, 'security')).toBe(true)
    expect(taskMatchesTextFilter(candidate, 'payments')).toBe(false)
    expect(taskMatchesTextFilter(candidate, '')).toBe(true)
  })
})

describe('backend-authoritative board partitioning', () => {
  const tasks = [task('focus'), task('running'), task('aside'), task('backlog', 'backlog'), task('done', 'done')]
  const attentionTaskIds = new Set(['focus'])
  const outOfFocusTaskIds = new Set(['aside'])

  it('uses backend membership for Focus and its inverse for In Flight', () => {
    expect(filterTasks(tasks, 'focus', attentionTaskIds, outOfFocusTaskIds).map((item) => item.id)).toEqual(['focus'])
    expect(filterTasks(tasks, 'in-flight', attentionTaskIds, outOfFocusTaskIds).map((item) => item.id)).toEqual(['running'])
  })

  it('keeps manually set-aside and backlog lanes independent', () => {
    expect(filterTasks(tasks, 'out-of-focus', attentionTaskIds, outOfFocusTaskIds).map((item) => item.id)).toEqual(['aside'])
    expect(filterTasks(tasks, 'backlog', attentionTaskIds, outOfFocusTaskIds).map((item) => item.id)).toEqual(['backlog'])
  })

  it('counts each Task in exactly one visible lane and hides legacy done rows', () => {
    expect(getFilterCounts(tasks, attentionTaskIds, outOfFocusTaskIds)).toEqual({
      focus: 1,
      'in-flight': 1,
      'out-of-focus': 1,
      backlog: 1,
    })
  })
})

describe('Focus state configuration compatibility', () => {
  it('uses current defaults when config is absent or malformed', async () => {
    ipc.getProjectConfig.mockResolvedValueOnce(null).mockResolvedValueOnce('{bad json')

    await expect(loadFocusFilterStates('P-1')).resolves.toEqual(DEFAULT_FOCUS_STATES)
    await expect(loadFocusFilterStates('P-1')).resolves.toEqual(DEFAULT_FOCUS_STATES)
  })

  it('keeps custom states while removing the non-focusable active state', async () => {
    ipc.getProjectConfig.mockResolvedValue(JSON.stringify(['failed', 'active']))

    await expect(loadFocusFilterStates('P-1')).resolves.toEqual(['failed'])
  })

  it('upgrades a legacy default set to the current defaults', async () => {
    ipc.getProjectConfig.mockResolvedValue(JSON.stringify([
      'idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted',
      'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments',
      'ready-to-merge', 'pr-merged',
    ]))

    await expect(loadFocusFilterStates('P-1')).resolves.toEqual(DEFAULT_FOCUS_STATES)
  })

  it('persists focus and set-aside configuration through typed project config', async () => {
    ipc.setProjectConfig.mockResolvedValue(undefined)

    await saveFocusFilterStates('P-1', ['failed', 'active'])
    await saveOutOfFocusTaskIds('P-1', new Set(['T-1', 'T-2']))

    expect(ipc.setProjectConfig).toHaveBeenNthCalledWith(1, 'P-1', 'focus_filter_states', JSON.stringify(['failed']))
    expect(ipc.setProjectConfig).toHaveBeenNthCalledWith(2, 'P-1', 'low_fire_task_ids', JSON.stringify(['T-1', 'T-2']))
  })

  it('loads only valid set-aside task ids', async () => {
    ipc.getProjectConfig.mockResolvedValueOnce(JSON.stringify(['T-1'])).mockResolvedValueOnce(JSON.stringify(['T-1', 2]))

    await expect(loadOutOfFocusTaskIds('P-1')).resolves.toEqual(new Set(['T-1']))
    await expect(loadOutOfFocusTaskIds('P-1')).resolves.toEqual(new Set())
  })
})
