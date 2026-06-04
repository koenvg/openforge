import type { ShellSessionIdentity } from '@openforge/plugin-sdk'

export function createProjectShellSession(projectId: string, ordinal: number): ShellSessionIdentity {
  return {
    id: `project-terminal:${projectId}:${ordinal}`,
    origin: { kind: 'project', projectId },
    ordinal,
  }
}

export function createTaskShellSession(taskId: string, ordinal: number): ShellSessionIdentity {
  return {
    id: `task-terminal:${taskId}:${ordinal}`,
    origin: { kind: 'task', taskId },
    ordinal,
  }
}
