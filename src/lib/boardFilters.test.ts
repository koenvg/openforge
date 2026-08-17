import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FOCUS_STATES,
  filterTasks,
  getFilterCounts,
  loadFocusFilterStates,
  loadOutOfFocusTaskIds,
  saveFocusFilterStates,
  saveOutOfFocusTaskIds,
} from './boardFilters'
import type { Task } from './types'

const ipc = vi.hoisted(() => ({
  getProjectConfig: vi.fn(),
  setProjectConfig: vi.fn(),
}))

vi.mock('./ipc', () => ipc)

function task(id: string, status: Task['status'] = 'doing'): Task {
  return {
    id,
    initial_prompt: id,
    status,
    prompt: null,
    title: id,
    title_source: null,
    title_generated_at: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    source_ticket_url: null,
    depends_on: [],
    project_id: 'P-1',
    created_at: 0,
    updated_at: 0,
  }
}

beforeEach(() => {
  ipc.getProjectConfig.mockReset()
  ipc.setProjectConfig.mockReset()
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
