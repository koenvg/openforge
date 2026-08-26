import { invokeDesktopCommand as invoke } from '../desktopIpc'

export async function getAppMode(): Promise<string> {
  return invoke<string>("get_app_mode");
}

export async function getGitBranch(): Promise<string> {
  return invoke<string>("get_git_branch");
}

export async function getProjectConfig(projectId: string, key: string): Promise<string | null> {
  return invoke<string | null>("get_project_config", { projectId, key });
}

export async function getResolvedAiProvider(projectId: string): Promise<string> {
  return invoke<string>("resolve_ai_provider", { projectId });
}

export async function setProjectConfig(projectId: string, key: string, value: string): Promise<void> {
  return invoke("set_project_config", { projectId, key, value });
}

export async function clearProjectConfig(projectId: string, key: string): Promise<void> {
  return invoke("clear_project_config", { projectId, key });
}

export async function getTaskConfig(taskId: string, key: string): Promise<string | null> {
  return invoke<string | null>("get_task_config", { taskId, key });
}

export async function setTaskConfig(taskId: string, key: string, value: string): Promise<void> {
  return invoke("set_task_config", { taskId, key, value });
}

export async function resetProjectSettingsToGlobal(projectId: string): Promise<void> {
  return invoke("reset_project_settings_to_global", { projectId });
}

export async function checkOpenCodeInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null }> {
  return invoke("check_opencode_installed");
}

export async function checkPiInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null }> {
  return invoke("check_pi_installed");
}

export async function checkCodexInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null }> {
  return invoke("check_codex_installed");
}

export async function checkGrokInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null; authenticated: boolean }> {
  return invoke<{ installed: boolean; path: string | null; version: string | null; authenticated: boolean }>("check_grok_installed");
}

export async function checkClaudeInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null; authenticated: boolean }> {
  return invoke<{ installed: boolean; path: string | null; version: string | null; authenticated: boolean }>("check_claude_installed");
}

export async function getConfig(key: string): Promise<string | null> {
  return invoke<string | null>("get_config", { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
  return invoke("set_config", { key, value });
}
