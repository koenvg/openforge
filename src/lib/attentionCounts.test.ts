import { vi } from 'vitest'

// boardFilters (transitively imported) pulls getProjectConfig/setProjectConfig from ipc,
// which would otherwise try to reach the Electron bridge in a unit test.
vi.mock('./ipc', () => ({ getProjectConfig: vi.fn(), setProjectConfig: vi.fn() }))

import { describe, it, expect } from 'vitest'
import type { Task, AgentSession, PullRequestInfo } from './types'
import type { TaskState } from './taskState'
import { DEFAULT_FOCUS_STATES } from './boardFilters'
import { buildAttentionCountByProject } from './attentionCounts'

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    initial_prompt: overrides.id,
    status: 'doing',
    prompt: null,
    title: null,
    title_source: null,
    title_generated_at: null,
    summary: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    handoff_notes_enabled: true,
    resume_session_id: null,
    depends_on: [],
    project_id: 'P-1',
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function makeSession(overrides: Partial<AgentSession> & { id: string }): AgentSession {
  return {
    ticket_id: 'T-1',
    opencode_session_id: null,
    stage: 'implement',
    status: 'completed',
    checkpoint_data: null,
    error_message: null,
    created_at: 1000,
    updated_at: 1000,
    provider: 'claude-code',
    claude_session_id: null,
    pi_session_id: null,
    ...overrides,
    pty_instance_id: overrides.pty_instance_id ?? null,
  }
}

function makePr(overrides: Partial<PullRequestInfo> & { id: number }): PullRequestInfo {
  return {
    ticket_id: 'T-1',
    repo_owner: 'test',
    repo_name: 'repo',
    title: 'Test PR',
    url: 'https://github.com/test/repo/pull/1',
    state: 'open',
    head_sha: 'abc123',
    ci_status: 'success',
    ci_check_runs: null,
    review_status: null,
    mergeable: true,
    mergeable_state: 'clean',
    merged_at: null,
    created_at: 1000,
    updated_at: 1000,
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
    pr_number: overrides.id,
    ...overrides,
  }
}

function sessionMap(sessions: AgentSession[]): Map<string, AgentSession> {
  return new Map(sessions.map((s) => [s.ticket_id, s]))
}

function prMap(prs: PullRequestInfo[]): Map<string, PullRequestInfo[]> {
  const map = new Map<string, PullRequestInfo[]>()
  for (const pr of prs) {
    const arr = map.get(pr.ticket_id) ?? []
    arr.push(pr)
    map.set(pr.ticket_id, arr)
  }
  return map
}

const NO_FOCUS_STATES = new Map<string, TaskState[]>()
const NO_OUT_OF_FOCUS = new Map<string, Set<string>>()

describe('buildAttentionCountByProject', () => {
  it('counts a task once even with many signals (completed + failing CI + 4 comments = 1, not 6)', () => {
    // This is the exact reported bug: the old sidebar summed heterogeneous signals
    // (completed_agents + ci_failures + per-comment count), inflating one task to 6.
    const tasks = [makeTask({ id: 'T-1', project_id: 'P-1' })]
    const sessions = sessionMap([makeSession({ id: 's-1', ticket_id: 'T-1', status: 'completed' })])
    const prs = prMap([makePr({ id: 1, ticket_id: 'T-1', ci_status: 'failure', unaddressed_comment_count: 4 })])

    const counts = buildAttentionCountByProject(tasks, sessions, prs, NO_FOCUS_STATES, NO_OUT_OF_FOCUS)

    expect(counts.get('P-1')).toBe(1)
  })

  it('excludes in-flight (running) and Out of Focus tasks — mirrors the Frontend Focus=4 case', () => {
    const tasks = [
      // 2 Out of Focus, completed, no PR -> agent-done but excluded from focus
      makeTask({ id: 'LF-1', project_id: 'P-1' }),
      makeTask({ id: 'LF-2', project_id: 'P-1' }),
      // 4 focus tasks
      makeTask({ id: 'F-1', project_id: 'P-1' }), // completed, no PR -> agent-done
      makeTask({ id: 'F-2', project_id: 'P-1' }), // completed, failing CI + comments
      makeTask({ id: 'F-3', project_id: 'P-1' }), // completed, failing CI + comments
      makeTask({ id: 'F-4', project_id: 'P-1' }), // completed, unaddressed comments
      // 1 in-flight (running) -> active => excluded
      makeTask({ id: 'RUN-1', project_id: 'P-1' }),
    ]
    const sessions = sessionMap([
      makeSession({ id: 's-lf1', ticket_id: 'LF-1', status: 'completed' }),
      makeSession({ id: 's-lf2', ticket_id: 'LF-2', status: 'completed' }),
      makeSession({ id: 's-f1', ticket_id: 'F-1', status: 'completed' }),
      makeSession({ id: 's-f2', ticket_id: 'F-2', status: 'completed' }),
      makeSession({ id: 's-f3', ticket_id: 'F-3', status: 'completed' }),
      makeSession({ id: 's-f4', ticket_id: 'F-4', status: 'completed' }),
      makeSession({ id: 's-run1', ticket_id: 'RUN-1', status: 'running' }),
    ])
    const prs = prMap([
      makePr({ id: 2, ticket_id: 'F-2', ci_status: 'failure', unaddressed_comment_count: 4 }),
      makePr({ id: 3, ticket_id: 'F-3', ci_status: 'failure', unaddressed_comment_count: 4 }),
      makePr({ id: 4, ticket_id: 'F-4', ci_status: 'success', unaddressed_comment_count: 2 }),
    ])

    const focusStates = new Map<string, TaskState[]>([['P-1', DEFAULT_FOCUS_STATES]])
    const outOfFocus = new Map<string, Set<string>>([['P-1', new Set(['LF-1', 'LF-2'])]])

    const counts = buildAttentionCountByProject(tasks, sessions, prs, focusStates, outOfFocus)

    expect(counts.get('P-1')).toBe(4)
  })

  it('groups tasks by project so each project gets its own focus count', () => {
    const tasks = [
      makeTask({ id: 'A-1', project_id: 'P-1' }),
      makeTask({ id: 'A-2', project_id: 'P-1' }),
      makeTask({ id: 'B-1', project_id: 'P-2' }),
    ]
    const sessions = sessionMap([
      makeSession({ id: 's-a1', ticket_id: 'A-1', status: 'completed' }),
      makeSession({ id: 's-a2', ticket_id: 'A-2', status: 'completed' }),
      makeSession({ id: 's-b1', ticket_id: 'B-1', status: 'completed' }),
    ])

    const counts = buildAttentionCountByProject(tasks, sessions, prMap([]), NO_FOCUS_STATES, NO_OUT_OF_FOCUS)

    expect(counts.get('P-1')).toBe(2)
    expect(counts.get('P-2')).toBe(1)
  })

  it('ignores tasks without a project id', () => {
    const tasks = [makeTask({ id: 'ORPHAN', project_id: null })]
    const sessions = sessionMap([makeSession({ id: 's-o', ticket_id: 'ORPHAN', status: 'completed' })])

    const counts = buildAttentionCountByProject(tasks, sessions, prMap([]), NO_FOCUS_STATES, NO_OUT_OF_FOCUS)

    expect(counts.size).toBe(0)
  })

  it('reports zero for a project whose only tasks are in-flight', () => {
    const tasks = [makeTask({ id: 'R-1', project_id: 'P-9' })]
    const sessions = sessionMap([makeSession({ id: 's-r1', ticket_id: 'R-1', status: 'running' })])

    const counts = buildAttentionCountByProject(tasks, sessions, prMap([]), NO_FOCUS_STATES, NO_OUT_OF_FOCUS)

    expect(counts.get('P-9')).toBe(0)
  })
})
