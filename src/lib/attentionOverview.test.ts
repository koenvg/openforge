import { describe, expect, it } from 'vitest'
import { buildAttentionOverview, emptyLaneRows, laneRowsByFilter } from './attentionOverview'
import type { BuildAttentionOverviewInput, LaneRows } from './attentionOverview'
import type { Project, ReviewPullRequest, Task, TaskAttentionRow, PrLabel } from './types'
import { DO_NOT_REVIEW_LABEL } from './types'

function project(id: string, overrides: Partial<Project> = {}): Project {
  return { id, name: id, path: `/repos/${id}`, created_at: 0, updated_at: 0, ...overrides }
}

function task(id: string, projectId: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    initial_prompt: id,
    status: 'doing',
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
    project_id: projectId,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

function attentionRow(taskId: string, projectId: string, overrides: Partial<TaskAttentionRow> = {}): TaskAttentionRow {
  return {
    task_id: taskId,
    project_id: projectId,
    project_name: projectId,
    title: taskId,
    state: 'idle',
    reason: 'No agent running. Start when ready.',
    activity_at: 0,
    ...overrides,
  }
}

function label(name: string): PrLabel {
  return { name, color: '' }
}

function review(id: number, owner: string, name: string, overrides: Partial<ReviewPullRequest> = {}): ReviewPullRequest {
  return {
    id,
    number: id,
    title: `PR ${id}`,
    repo_owner: owner,
    repo_name: name,
    viewed_at: null,
    updated_at: id,
    labels: [],
    ...overrides,
  } as ReviewPullRequest
}

function lanes(overrides: Partial<LaneRows> = {}): LaneRows {
  return { ...emptyLaneRows(), ...overrides }
}

function baseInput(overrides: Partial<BuildAttentionOverviewInput> = {}): BuildAttentionOverviewInput {
  return {
    projects: [],
    allTasks: [],
    taskRowsByLane: emptyLaneRows(),
    reviewPrs: [],
    excludedRepos: new Set(),
    resolvedRepoByProject: new Map(),
    ...overrides,
  }
}

describe('buildAttentionOverview — backend-projected tasks', () => {
  it('preserves backend membership, ordering, state, reason, and title', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      allTasks: [task('newer', 'p1'), task('older', 'p1'), task('not-projected', 'p1')],
      taskRowsByLane: lanes({
        focus: [
          attentionRow('newer', 'p1', {
            title: 'Backend title',
            state: 'needs-input',
            reason: 'Backend reason',
            activity_at: 20,
          }),
          attentionRow('older', 'p1', { activity_at: 10 }),
        ],
      }),
    }))

    expect(result.groups[0].tasksByLane.focus.map((item) => ({
      id: item.task.id,
      title: item.title,
      state: item.state,
      reason: item.reason,
      activityAt: item.activityAt,
    }))).toEqual([
      { id: 'newer', title: 'Backend title', state: 'needs-input', reason: 'Backend reason', activityAt: 20 },
      { id: 'older', title: 'older', state: 'idle', reason: 'No agent running. Start when ready.', activityAt: 10 },
    ])
  })

  it('groups rows by project and drops stale rows without a desktop Task record', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1'), project('p2')],
      allTasks: [task('a', 'p1'), task('b', 'p2')],
      taskRowsByLane: lanes({
        focus: [attentionRow('a', 'p1'), attentionRow('missing', 'p1'), attentionRow('b', 'p2')],
      }),
    }))

    expect(result.groups.map((group) => ({
      projectId: group.project.id,
      taskIds: group.tasksByLane.focus.map((item) => item.task.id),
    }))).toEqual([
      { projectId: 'p1', taskIds: ['a'] },
      { projectId: 'p2', taskIds: ['b'] },
    ])
  })
})

describe('buildAttentionOverview — lane keys', () => {
  it('renames the backend lane keys onto the board filter ids the renderer uses', () => {
    const focus = [attentionRow('f', 'p1')]
    const inFlight = [attentionRow('i', 'p1')]
    const outOfFocus = [attentionRow('o', 'p1')]
    const backlog = [attentionRow('b', 'p1')]

    expect(laneRowsByFilter({
      focus,
      in_flight: inFlight,
      out_of_focus: outOfFocus,
      backlog,
    })).toEqual({
      focus,
      'in-flight': inFlight,
      'out-of-focus': outOfFocus,
      backlog,
    })
  })
})

describe('buildAttentionOverview — the non-focus lanes', () => {
  it('carries all four lanes on the same project group, with per-lane totals', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      allTasks: [task('focused', 'p1'), task('flying', 'p1'), task('parked', 'p1'), task('waiting', 'p1')],
      taskRowsByLane: lanes({
        focus: [attentionRow('focused', 'p1')],
        'in-flight': [attentionRow('flying', 'p1', { state: 'active', activity_at: 500 })],
        'out-of-focus': [attentionRow('parked', 'p1', { title: 'Parked work', state: 'paused' })],
        backlog: [attentionRow('waiting', 'p1', { state: 'backlog' })],
      }),
    }))

    const group = result.groups[0]
    expect(group.tasksByLane.focus.map((item) => item.task.id)).toEqual(['focused'])
    expect(group.tasksByLane['in-flight'].map((item) => ({ id: item.task.id, activityAt: item.activityAt })))
      .toEqual([{ id: 'flying', activityAt: 500 }])
    expect(group.tasksByLane['out-of-focus'].map((item) => ({ id: item.task.id, title: item.title, state: item.state })))
      .toEqual([{ id: 'parked', title: 'Parked work', state: 'paused' }])
    expect(group.tasksByLane.backlog.map((item) => item.task.id)).toEqual(['waiting'])
    expect(result.totalTasksByLane).toEqual({
      focus: 1,
      'in-flight': 1,
      'out-of-focus': 1,
      backlog: 1,
    })
  })

  it('keeps a project whose only rows sit outside the focus lane, so those lanes can show it', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1'), project('p2')],
      allTasks: [task('parked', 'p2')],
      taskRowsByLane: lanes({ 'out-of-focus': [attentionRow('parked', 'p2')] }),
    }))

    expect(result.groups.map((group) => group.project.id)).toEqual(['p2'])
    expect(result.groups[0].tasksByLane.focus).toHaveLength(0)
  })

  it('drops rows for hidden projects and rows without a desktop Task record, in every lane', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1'), project('hidden')],
      allTasks: [task('parked', 'p1'), task('queued', 'p1'), task('hidden-parked', 'hidden')],
      taskRowsByLane: lanes({
        'out-of-focus': [
          attentionRow('parked', 'p1'),
          attentionRow('stale', 'p1'),
          attentionRow('hidden-parked', 'hidden'),
        ],
        backlog: [attentionRow('queued', 'p1'), attentionRow('also-stale', 'p1')],
      }),
      hiddenProjectIds: new Set(['hidden']),
    }))

    expect(result.groups.map((group) => group.project.id)).toEqual(['p1'])
    expect(result.groups[0].tasksByLane['out-of-focus'].map((item) => item.task.id)).toEqual(['parked'])
    expect(result.groups[0].tasksByLane.backlog.map((item) => item.task.id)).toEqual(['queued'])
    expect(result.totalTasksByLane['out-of-focus']).toBe(1)
    expect(result.totalTasksByLane.backlog).toBe(1)
  })
})

describe('buildAttentionOverview — standalone review PRs', () => {
  it('includes only unopened, non-DO-NOT-REVIEW, non-excluded PRs for the matching project', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      resolvedRepoByProject: new Map([['p1', 'me/app']]),
      reviewPrs: [
        review(1, 'me', 'app'),
        review(2, 'me', 'app', { viewed_at: 123 }),
        review(3, 'me', 'app', { labels: [label(DO_NOT_REVIEW_LABEL)] }),
      ],
    }))
    expect(result.groups[0].reviewPrs.map((pr) => pr.id)).toEqual([1])
  })

  it('honors excluded repos and routes unmatched PRs to Other repositories', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      resolvedRepoByProject: new Map([['p1', 'me/app']]),
      reviewPrs: [review(1, 'me', 'app'), review(2, 'other', 'repo')],
      excludedRepos: new Set(['me/app']),
    }))

    expect(result.groups).toHaveLength(0)
    expect(result.otherReviewPrs.map((pr) => pr.id)).toEqual([2])
  })

  it('maps a shared-repo PR to the first visible project in sidebar order', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('hidden'), project('visible')],
      resolvedRepoByProject: new Map([['hidden', 'me/shared'], ['visible', 'me/shared']]),
      reviewPrs: [review(1, 'me', 'shared')],
      hiddenProjectIds: new Set(['hidden']),
    }))

    expect(result.groups.map((group) => group.project.id)).toEqual(['visible'])
    expect(result.groups[0].reviewPrs.map((pr) => pr.id)).toEqual([1])
  })

  it('drops a PR owned only by hidden projects instead of routing it to Other', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1')],
      resolvedRepoByProject: new Map([['p1', 'me/app']]),
      reviewPrs: [review(1, 'me', 'app')],
      hiddenProjectIds: new Set(['p1']),
    }))

    expect(result.groups).toHaveLength(0)
    expect(result.otherReviewPrs).toHaveLength(0)
    expect(result.totalReviewPrs).toBe(0)
  })
})

describe('buildAttentionOverview — grouping and totals', () => {
  it('preserves sidebar project order, hides empty/hidden projects, and computes totals', () => {
    const result = buildAttentionOverview(baseInput({
      projects: [project('p1'), project('p2'), project('p3'), project('hidden')],
      allTasks: [task('t3', 'p3'), task('t1', 'p1'), task('hidden-task', 'hidden')],
      taskRowsByLane: lanes({
        focus: [
          attentionRow('t3', 'p3'),
          attentionRow('t1', 'p1'),
          attentionRow('hidden-task', 'hidden'),
        ],
      }),
      reviewPrs: [review(9, 'other', 'repo')],
      hiddenProjectIds: new Set(['hidden']),
    }))

    expect(result.groups.map((group) => group.project.id)).toEqual(['p1', 'p3'])
    expect(result.totalTasksByLane.focus).toBe(2)
    expect(result.totalReviewPrs).toBe(1)
    expect(result.otherReviewPrs.map((pr) => pr.id)).toEqual([9])
  })
})
