import type { ListTaskSessionsRequest, TaskFollowUpReceipt } from '@openforge-app/plugin-sdk'
import { invokeDesktopCommand as invoke } from '../desktopIpc'
import type { AgentSession, AutocompleteAgentInfo, CommandInfo, ProviderModelInfo } from '../types'

export async function getSessionStatus(sessionId: string): Promise<AgentSession> {
  return invoke<AgentSession>("get_session_status", { sessionId });
}

export async function abortSession(sessionId: string): Promise<void> {
  return invoke("abort_session", { sessionId });
}

export async function getLatestSession(taskId: string): Promise<AgentSession | null> {
  return invoke<AgentSession | null>("get_latest_session", { taskId });
}

export async function listAgentSessions(request: ListTaskSessionsRequest): Promise<AgentSession[]> {
  return invoke<AgentSession[]>('get_agent_sessions', {
    taskId: request.taskId,
    provider: request.provider,
    createdAtOrAfter: request.createdAtOrAfter,
  })
}

export async function sendAgentFollowUp(taskId: string, message: string): Promise<TaskFollowUpReceipt> {
  return invoke<TaskFollowUpReceipt>('send_agent_follow_up', { taskId, message })
}

export async function getLatestSessions(taskIds: string[]): Promise<AgentSession[]> {
  return invoke<AgentSession[]>("get_latest_sessions", { taskIds });
}

export async function listOpenCodeCommands(projectId: string): Promise<CommandInfo[]> {
  return invoke<CommandInfo[]>("list_opencode_commands", { projectId });
}

export async function listOpenCodeAgents(projectId: string): Promise<AutocompleteAgentInfo[]> {
  return invoke<AutocompleteAgentInfo[]>("list_opencode_agents", { projectId });
}

export async function listOpenCodeModels(projectId: string): Promise<ProviderModelInfo[]> {
  return invoke<ProviderModelInfo[]>("list_opencode_models", { projectId });
}

export async function finalizeAgentSession(taskId: string, success: boolean, ptyInstanceId: number): Promise<void> {
  return invoke<void>("finalize_agent_session", { taskId, success, ptyInstanceId });
}
