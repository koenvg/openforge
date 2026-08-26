import type { TerminalImageProtocol } from '@openforge-app/terminal-runtime'
import { normalizeTask } from '../boardStatus'
import { invokeDesktopCommand as invoke } from '../desktopIpc'
import type { BoardStatus, DivergenceResolution, ExistingBranchPlan, GitBranchInfo, ImplementationStatus, Project, ProjectAttention, Task, TaskAttentionRow, TaskLabel, TaskLaneRows, TaskWorkspaceInfo, WorktreeInfo, WorktreeSource, WritableBoardStatus } from '../types'

type RawTask = Omit<Task, 'status'> & { status: string }

export interface CreateTaskOptions {
  dependsOn?: string[]
  labelNames?: string[]
  worktreeSource?: WorktreeSource | null
  worktreeBranch?: string | null
  /** Explicit display title; null/empty falls back to the prompt-derived title. */
  title?: string | null
  /** Optional link to the source ticket (e.g. GitHub issue / Jira URL); null/empty stores nothing. */
  sourceTicketUrl?: string | null
  /** Task-level cleanup override; omit to inherit the project/global default. */
  codeCleanupEnabled?: boolean
  /** Task-level title-auto-update override; omit to inherit the project/global default. */
  taskDisplayTitleUpdatesEnabled?: boolean
  /** Task-level AI provider override; null/omit to inherit the project/global default. */
  aiProvider?: string | null
}

export async function createTask(initialPrompt: string, status: BoardStatus, projectId: string | null, permissionMode: string | null, options: CreateTaskOptions = {}): Promise<Task> {
  const {
    dependsOn = [],
    labelNames = [],
    worktreeSource = null,
    worktreeBranch = null,
    title = null,
    sourceTicketUrl = null,
    codeCleanupEnabled,
    taskDisplayTitleUpdatesEnabled,
    aiProvider = null,
  } = options
  const task = await invoke<RawTask>("create_task", { initialPrompt, status, projectId, permissionMode, dependsOn, labelNames, worktreeSource, worktreeBranch, title, sourceTicketUrl, codeCleanupEnabled, taskDisplayTitleUpdatesEnabled, aiProvider });
  return normalizeTask(task)
}

export async function updateTaskInitialPrompt(id: string, initialPrompt: string): Promise<void> {
  return invoke("update_task", { id, initialPrompt });
}

export async function updateTaskTitle(id: string, title: string): Promise<void> {
  return invoke("update_task_title", { id, title });
}

export async function updateTaskSourceTicketUrl(id: string, sourceTicketUrl: string | null): Promise<void> {
  return invoke("update_task_source_ticket_url", { id, sourceTicketUrl });
}

export async function updateTaskStatus(id: string, status: WritableBoardStatus): Promise<void> {
  return invoke("update_task_status", { id, status });
}

export async function deleteTask(id: string): Promise<void> {
  return invoke("delete_task", { id });
}

export async function createProject(name: string, path: string): Promise<Project> {
  return invoke<Project>("create_project", { name, path });
}

export async function createProjectFromGit(args: {
  url: string
  parentDir: string
  name: string
}): Promise<Project> {
  return invoke<Project>("create_project_from_git", { url: args.url, parentDir: args.parentDir, name: args.name });
}

export async function createProjectFromNewRepo(args: {
  name: string
  parentDir: string
  private: boolean
}): Promise<Project> {
  return invoke<Project>("create_project_from_new_repo", { name: args.name, parentDir: args.parentDir, private: args.private });
}

export async function getProjects(): Promise<Project[]> {
  return invoke<Project[]>("get_projects");
}

export async function updateProject(id: string, name: string, path: string): Promise<void> {
  return invoke("update_project", { id, name, path });
}

export async function deleteProject(id: string): Promise<void> {
  return invoke("delete_project", { id });
}

export async function getProjectAttention(): Promise<ProjectAttention[]> {
  return invoke<ProjectAttention[]>("get_project_attention");
}

export async function getTaskAttention(): Promise<TaskAttentionRow[]> {
  return invoke<TaskAttentionRow[]>("get_task_attention");
}

/**
 * Every startable task across all projects, split into the four board lanes and sharing the
 * attention-row shape. `focus` matches `getTaskAttention`.
 */
export async function getTaskLanes(): Promise<TaskLaneRows> {
  return invoke<TaskLaneRows>("get_task_lanes");
}

export async function getAllTasks(): Promise<Task[]> {
  const tasks = await invoke<RawTask[]>("get_tasks");
  return tasks.map(normalizeTask)
}

export async function getTasksForProject(projectId: string, includeDone = false): Promise<Task[]> {
  const tasks = await invoke<RawTask[]>("get_tasks_for_project", { projectId, includeDone });
  return tasks.map(normalizeTask)
}

export async function getProjectTaskLabels(projectId: string): Promise<TaskLabel[]> {
  return invoke<TaskLabel[]>("get_project_task_labels", { projectId })
}

export async function createTaskLabel(projectId: string, name: string): Promise<TaskLabel> {
  return invoke<TaskLabel>("create_task_label", { projectId, name })
}

export async function addTaskLabel(taskId: string, name: string): Promise<TaskLabel> {
  return invoke<TaskLabel>("add_task_label", { taskId, name })
}

export async function removeTaskLabel(taskId: string, labelId: number): Promise<void> {
  return invoke("remove_task_label", { taskId, labelId })
}

export async function deleteTaskLabel(labelId: number): Promise<void> {
  return invoke("delete_task_label", { labelId })
}

export async function startImplementation(
  taskId: string,
  repoPath: string,
  divergenceResolution: DivergenceResolution | null = null,
  terminalImageProtocol: TerminalImageProtocol | null = null,
  promptPrefix: string | null = null,
): Promise<ImplementationStatus> {
  return invoke<ImplementationStatus>("start_implementation", {
    taskId,
    repoPath,
    divergenceResolution,
    terminalImageProtocol,
    promptPrefix,
  });
}

export async function getWorktreeForTask(taskId: string): Promise<WorktreeInfo | null> {
  return invoke<WorktreeInfo | null>("get_worktree_for_task", { taskId });
}

export async function listGitBranches(repoPath: string): Promise<GitBranchInfo[]> {
  return invoke<GitBranchInfo[]>("list_git_branches", { repoPath });
}

export async function repoHasCommits(repoPath: string): Promise<boolean> {
  return invoke<boolean>("repo_has_commits", { repoPath });
}

export async function inspectExistingBranch(repoPath: string, branch: string): Promise<ExistingBranchPlan> {
  return invoke<ExistingBranchPlan>("inspect_existing_branch", { repoPath, branch });
}

export async function getTaskWorkspace(taskId: string): Promise<TaskWorkspaceInfo | null> {
  return invoke<TaskWorkspaceInfo | null>("get_task_workspace", { taskId });
}

export async function getTaskDetail(taskId: string): Promise<Task> {
  const task = await invoke<RawTask>("get_task_detail", { taskId });
  return normalizeTask(task)
}
