import type { TaskDetail } from '../../../lib/types'
import type { TaskLevelDefaults } from '../../../lib/taskDefaults'
import type { TaskCreationAdapter } from '../taskCreationAdapter'

/** In-memory backend and browser I/O for tests through the workflow interface. */
export class LocalTaskCreationAdapter implements TaskCreationAdapter {
  defaults: TaskLevelDefaults = { aiProvider: 'claude-code', useWorktrees: true, taskDisplayTitleUpdatesEnabled: false }
  branches: Awaited<ReturnType<TaskCreationAdapter['listGitBranches']>> = []
  hasCommits = true
  clipboardImage: Blob | null = null
  created: Array<{ prompt: string, projectId: string, options: Parameters<TaskCreationAdapter['createTask']>[4], permissionMode: Parameters<TaskCreationAdapter['createTask']>[3] }> = []
  updated: Array<{ id: string, prompt: string }> = []
  tasks: TaskDetail[] = []

  async loadTaskLevelDefaults() { return this.defaults }
  async repoHasCommits() { return this.hasCommits }
  async listGitBranches() { return this.branches }
  async readImage() { return 'data:image/png;base64,dGVzdA==' }
  async readClipboardImage() { return this.clipboardImage }
  async updateTaskInitialPrompt(id: string, prompt: string) { this.updated.push({ id, prompt }) }
  async createTask(...[prompt, status, projectId, permissionMode, options]: Parameters<TaskCreationAdapter['createTask']>): Promise<TaskDetail> {
    this.created.push({ prompt, projectId, permissionMode, options })
    const task: TaskDetail = {
      id: `T-${this.created.length}`, projectId, prompt, promptPreview: prompt,
      status, title: options?.title ?? prompt, titleSource: null, titleGeneratedAt: null,
      agent: null, permissionMode: permissionMode ?? null,
      worktreeSource: options?.worktreeSource ?? null, worktreeBranch: options?.worktreeBranch ?? null,
      sourceTicketUrl: options?.sourceTicketUrl ?? null,
      dependsOn: [], labels: [], createdAt: 1000, updatedAt: 1000,
    }
    this.tasks.push(task)
    return task
  }
}
