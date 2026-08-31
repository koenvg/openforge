import { describe, expect, it } from 'vitest'
import { filterActions, getAvailableActions, getGlobalActions, getTaskActions } from './actionPalette'
import { APP_SHORTCUT_DEFINITIONS } from './appShortcutDefinitions'
import type { TaskDetail, PullRequestInfo } from './types'
import { createTask } from '../App.test-fixtures/tasks'

function makeTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return createTask({ id: 'T-100', status: 'backlog', ...overrides })
}

function makePR(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 1,
    pr_number: 1,
    ticket_id: 'T-100',
    repo_owner: 'test',
    repo_name: 'test',
    title: 'Test PR',
    url: 'https://github.com/test/test/pull/1',
    state: 'open',
    head_sha: 'abc',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: 'APPROVED',
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
    created_at: 0,
    updated_at: 0,
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
    allowed_merge_methods: '["merge"]',
    default_merge_method: 'merge',
    ...overrides,
  }
}

describe('getTaskActions', () => {
  it('labels the terminal action Delete for a backlog task and does not show Complete', () => {
    const task = makeTask({ status: 'backlog' })
    const actions = getTaskActions(task, [])
    const ids = actions.map(a => a.id)
    expect(ids).toContain('start-task')
    expect(ids).not.toContain('move-to-done')
    expect(ids).toContain('delete-task')
    expect(actions.find(a => a.id === 'delete-task')?.label).toBe('Delete')
    expect(actions.some(a => a.label === 'Complete')).toBe(false)
  })

  it('returns canonical metadata for doing task actions', () => {
    const task = makeTask({ status: 'doing' })
    const actions = getTaskActions(task, [])
    const ids = actions.map(a => a.id)
    expect(ids).not.toContain('start-task')
    expect(ids).not.toContain('delete-task')
    expect(actions.find(a => a.id === 'set-aside-task')).toMatchObject({
      label: 'Set aside',
      icon: 'visibility_off',
      requiresConfirmation: false,
    })
    expect(ids).not.toContain('return-to-board')
    expect(actions.find(a => a.id === 'complete-task')).toMatchObject({
      label: 'Complete',
      icon: 'complete',
      requiresConfirmation: true,
    })
    expect(ids.indexOf('set-aside-task')).toBeGreaterThan(ids.indexOf('complete-task'))
  })

  it('appends Run app without displacing the existing task action order when available', () => {
    const task = makeTask({ status: 'doing' })
    const availableActions = getTaskActions(task, [], new Set(), { canRunApp: true })
    const unavailableActions = getTaskActions(task, [], new Set(), { canRunApp: false })

    expect(availableActions.at(-1)).toMatchObject({
      id: 'run-app',
      label: 'Run app',
      category: 'task',
    })
    expect(availableActions.filter(action => action.id !== 'run-app')).toEqual(unavailableActions)
  })

  it('returns Return to Board for doing task already Out of Focus', () => {
    const task = makeTask({ status: 'doing' })
    const actions = getTaskActions(task, [], new Set([task.id]))
    const ids = actions.map(a => a.id)
    expect(actions.find(a => a.id === 'return-to-board')).toMatchObject({
      label: 'Return to Board',
      icon: 'visibility',
      requiresConfirmation: false,
    })
    expect(ids).not.toContain('set-aside-task')
    expect(ids).toContain('complete-task')
  })

  it('labels the terminal action Complete for a done task', () => {
    const task = makeTask({ status: 'done' })
    const actions = getTaskActions(task, [])
    const ids = actions.map(a => a.id)
    expect(ids).toContain('complete-task')
    expect(actions.find(a => a.id === 'complete-task')?.label).toBe('Complete')
    expect(actions.some(a => a.label === 'Delete')).toBe(false)
    expect(ids).not.toContain('move-to-done')
    expect(ids).not.toContain('start-task')
  })

  it('returns allowed merge methods with the GitHub default first', () => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR({
      pr_number: 42,
      mergeable: true,
      mergeable_state: 'clean',
      state: 'open',
      draft: false,
      review_status: 'APPROVED',
      ci_status: 'success',
      allowed_merge_methods: '["merge","squash","rebase"]',
      default_merge_method: 'squash',
    })
    const mergeActions = getTaskActions(task, [pr]).filter(action => action.mergeMethod !== undefined)

    expect(mergeActions).toMatchObject([
      { id: 'merge-pr:squash', label: 'Squash and merge PR #42', mergeMethod: 'squash', isDefaultMergeMethod: true },
      { id: 'merge-pr:merge', label: 'Create a merge commit for PR #42', mergeMethod: 'merge', isDefaultMergeMethod: false },
      { id: 'merge-pr:rebase', label: 'Rebase and merge PR #42', mergeMethod: 'rebase', isDefaultMergeMethod: false },
    ])
    expect(mergeActions.every(action => action.requiresConfirmation)).toBe(true)
  })

  it('does not return Merge Pull Request action when PR has merge conflicts', () => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR({ mergeable: false, mergeable_state: 'dirty' })
    const actions = getTaskActions(task, [pr])
    expect(actions.some(action => action.mergeMethod !== undefined)).toBe(false)
  })

  it('returns Merge Pull Request action from current persisted ready_to_merge readiness', () => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR({ mergeable: null, mergeable_state: null, merge_readiness_status: 'ready_to_merge', merge_readiness_action: 'merge', readiness_source_head_sha: 'abc', readiness_updated_at: 0 })
    const actions = getTaskActions(task, [pr])
    const ids = actions.map(a => a.id)
    expect(ids).toContain('merge-pr:merge')
  })

  it('does not return Merge Pull Request action from stale persisted ready_to_merge readiness', () => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR({ head_sha: 'new-head', mergeable: null, mergeable_state: 'unknown', merge_readiness_status: 'ready_to_merge', merge_readiness_action: 'merge', readiness_source_head_sha: 'old-head', readiness_updated_at: 1 })
    const actions = getTaskActions(task, [pr])
    expect(actions.some(action => action.mergeMethod !== undefined)).toBe(false)
  })

  it('does not return Merge Pull Request action when PR is already queued', () => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR({ is_queued: true })
    const actions = getTaskActions(task, [pr])
    expect(actions.some(action => action.mergeMethod !== undefined)).toBe(false)
  })

  it('returns Enqueue Pull Request action from current persisted ready_to_enqueue readiness', () => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR({ merge_readiness_status: 'ready_to_enqueue', merge_readiness_action: 'enqueue', readiness_source_head_sha: 'abc', readiness_updated_at: 0 })
    const actions = getTaskActions(task, [pr])
    const ids = actions.map(a => a.id)
    expect(ids).toContain('enqueue-pr')
    expect(actions.some(action => action.mergeMethod !== undefined)).toBe(false)
  })

  it('does not return Enqueue Pull Request action from stale persisted ready_to_enqueue readiness', () => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR({ head_sha: 'new-head', mergeable: null, mergeable_state: 'unknown', merge_readiness_status: 'ready_to_enqueue', merge_readiness_action: 'enqueue', readiness_source_head_sha: 'old-head', readiness_updated_at: 1 })
    const actions = getTaskActions(task, [pr])
    const ids = actions.map(a => a.id)
    expect(ids).not.toContain('enqueue-pr')
    expect(actions.some(action => action.mergeMethod !== undefined)).toBe(false)
  })

  it('does not return Enqueue Pull Request action when PR is already queued', () => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR({ is_queued: true, merge_readiness_status: 'queued_pull_request', merge_readiness_action: 'wait_for_queue', readiness_source_head_sha: 'abc', readiness_updated_at: 0 })
    const actions = getTaskActions(task, [pr])
    const ids = actions.map(a => a.id)
    expect(ids).not.toContain('enqueue-pr')
  })

  it.each([
    ['pending CI', { ci_status: 'pending', mergeable_state: 'clean' }],
    ['draft PR', { draft: true, mergeable_state: 'clean', ci_status: 'success' }],
    ['unknown mergeability', { mergeable: null, mergeable_state: 'unknown', ci_status: 'success' }],
    ['null mergeability', { mergeable: null, mergeable_state: null, ci_status: 'success' }],
  ] satisfies Array<[string, Partial<PullRequestInfo>]>)('does not return Merge Pull Request action for %s', (_label, overrides) => {
    const task = makeTask({ status: 'doing' })
    const pr = makePR(overrides)
    const actions = getTaskActions(task, [pr])
    expect(actions.some(action => action.mergeMethod !== undefined)).toBe(false)
  })

  it('does not return Merge Pull Request action when multiple PRs are ready to merge', () => {
    const task = makeTask({ status: 'doing' })
    const firstPr = makePR({ id: 1, title: 'First ready PR' })
    const secondPr = makePR({ id: 2, title: 'Second ready PR', head_sha: 'def' })
    const actions = getTaskActions(task, [firstPr, secondPr])
    expect(actions.some(action => action.mergeMethod !== undefined)).toBe(false)
  })
})

describe('getGlobalActions', () => {
  it('returns global actions without Work Queue navigation', () => {
    const actions = getGlobalActions()
    expect(actions).toHaveLength(5)
    const ids = actions.map(a => a.id)
    expect(ids).toContain('go-back')
    expect(ids).toContain('search-tasks')
    expect(ids).toContain('new-task')
    expect(ids).toContain('switch-project')
    expect(ids).toContain('refresh-github')
    expect(ids).not.toContain('open-workqueue')
  })

  it('uses shared app shortcut definitions for global action labels and shortcuts', () => {
    const actions = getGlobalActions()
    const shortcutDefinitions = new Map(APP_SHORTCUT_DEFINITIONS.map(definition => [definition.id, definition]))

    for (const actionId of ['go-back', 'search-tasks', 'new-task', 'switch-project', 'refresh-github']) {
      const action = actions.find(candidate => candidate.id === actionId)
      const definition = shortcutDefinitions.get(actionId)
      const primaryShortcut = definition?.registrations[0]?.key ?? definition?.help?.keys[0]?.join('') ?? null

      expect(action, `missing global action ${actionId}`).toBeDefined()
      expect(definition, `missing shortcut definition ${actionId}`).toBeDefined()
      expect(action?.label).toBe(definition?.help?.label)
      expect(action?.shortcut).toBe(primaryShortcut)
    }
  })
})

describe('getAvailableActions', () => {
  it('returns task actions + global actions when task is provided', () => {
    const task = makeTask({ status: 'doing' })
    const actions = getAvailableActions(task, [])
    const ids = actions.map(a => a.id)
    expect(ids).not.toContain('move-to-done')
    expect(ids).toContain('set-aside-task')
    expect(ids).toContain('complete-task')
    expect(ids).toContain('go-back')
    expect(ids).toContain('search-tasks')
  })

  it('returns global actions only when task is null', () => {
    const actions = getAvailableActions(null, [])
    const ids = actions.map(a => a.id)
    expect(ids).not.toContain('move-to-done')
    expect(ids).not.toContain('delete-task')
    expect(ids).toContain('go-back')
    expect(ids).toContain('search-tasks')
  })
})

describe('filterActions', () => {
  it('returns all actions for empty query', () => {
    const actions = getGlobalActions()
    expect(filterActions(actions, '')).toEqual(actions)
  })

  it('matches label substring case-insensitively', () => {
    const actions = getGlobalActions()
    const result = filterActions(actions, 'search')
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.some(a => a.id === 'search-tasks')).toBe(true)
  })

  it('matches keywords', () => {
    const actions = getGlobalActions()
    const result = filterActions(actions, 'find')
    expect(result.some(a => a.id === 'search-tasks')).toBe(true)
  })

  it('returns empty for no match', () => {
    const actions = getGlobalActions()
    expect(filterActions(actions, 'zzzzzznotexist')).toEqual([])
  })
})
