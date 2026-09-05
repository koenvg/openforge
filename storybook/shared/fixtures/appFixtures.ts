import type {
  FileContent,
  FileEntry,
  Project,
  PullRequestInfo,
  TaskDetail,
  TaskWorkspaceInfo,
} from '../../../src/lib/types'

const FIXED_CREATED_AT = Date.UTC(2026, 0, 2, 9) / 1000
const FIXED_UPDATED_AT = Date.UTC(2026, 0, 2, 9, 25) / 1000

type TextFileContent = FileContent & { type: 'text' }

export function createTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: 'T-42',
    projectId: 'project-1',
    status: 'doing',
    title: 'Implement Storybook coverage',
    prompt: 'Implement Storybook coverage for the OpenForge interface.',
    promptPreview: 'Implement Storybook coverage for the OpenForge interface.',
    agent: null,
    permissionMode: null,
    worktreeSource: null,
    worktreeBranch: null,
    sourceTicketUrl: null,
    titleSource: null,
    titleGeneratedAt: null,
    createdAt: FIXED_CREATED_AT,
    updatedAt: FIXED_UPDATED_AT,
    ...overrides,
    dependsOn: [...(overrides.dependsOn ?? [])],
    labels: [...(overrides.labels ?? [])],
  }
}

export function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'OpenForge',
    path: '/workspace/openforge',
    created_at: FIXED_CREATED_AT,
    updated_at: FIXED_UPDATED_AT,
    ...overrides,
  }
}

export function createPullRequest(
  overrides: Partial<PullRequestInfo> = {},
): PullRequestInfo {
  return {
    id: 42,
    pr_number: 42,
    ticket_id: 'T-42',
    repo_owner: 'openforge',
    repo_name: 'openforge',
    title: 'Add deterministic UI catalogs',
    url: 'https://github.com/openforge/openforge/pull/42',
    state: 'open',
    head_sha: 'abc123',
    ci_status: null,
    ci_check_runs: null,
    review_status: null,
    mergeable: null,
    mergeable_state: null,
    merged_at: null,
    created_at: FIXED_CREATED_AT,
    updated_at: FIXED_UPDATED_AT,
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
    ...overrides,
  }
}

export function createTaskWorkspaceInfo(
  overrides: Partial<TaskWorkspaceInfo> = {},
): TaskWorkspaceInfo {
  return {
    id: 1,
    task_id: 'T-42',
    project_id: 'project-1',
    repo_path: '/workspace/openforge',
    workspace_path: '/workspace/openforge/.openforge/worktrees/T-42',
    kind: 'worktree',
    branch_name: 'openforge/T-42',
    provider_name: 'pi',
    status: 'ready',
    created_at: FIXED_CREATED_AT,
    updated_at: FIXED_UPDATED_AT,
    ...overrides,
  }
}

export function createFileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name: 'README.md',
    path: 'README.md',
    isDir: false,
    size: 12,
    modifiedAt: FIXED_UPDATED_AT,
    ...overrides,
  }
}

export function createTextFileContent(
  overrides: Partial<TextFileContent> = {},
): TextFileContent {
  const content = overrides.content ?? 'Hello world\n'
  return {
    type: 'text',
    content,
    mimeType: 'text/plain',
    size: new TextEncoder().encode(content).byteLength,
    ...overrides,
  }
}

export interface StorySettingsFixture {
  config: Record<string, string>
  projectConfig: Record<string, Record<string, string>>
}

export interface StorySettingsOverrides {
  theme?: 'openforge-dark' | 'openforge-light'
  provider?: string
  projectId?: string
  projectProvider?: string
}

export function createStorySettings(
  overrides: StorySettingsOverrides = {},
): StorySettingsFixture {
  const projectId = overrides.projectId ?? 'project-1'
  return {
    config: {
      theme: overrides.theme ?? 'openforge-dark',
      provider: overrides.provider ?? 'pi',
    },
    projectConfig: {
      [projectId]: { provider: overrides.projectProvider ?? 'codex' },
    },
  }
}
