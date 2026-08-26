import { invokeDesktopCommand as invoke } from '../desktopIpc'
import type { DeveloperLogEntry, DeveloperLogSnapshot } from '../types'

export async function openInEditor(path: string): Promise<void> {
  return invoke("open_in_editor", { path });
}

export async function hasVsCodeProtocolHandler(): Promise<boolean> {
  return invoke<boolean>("has_vscode_protocol_handler");
}

export async function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

export async function quitApp(): Promise<void> {
  return invoke("quit_app");
}

export async function getDeveloperLogs(limit?: number): Promise<DeveloperLogEntry[]> {
  return limit === undefined
    ? invoke<DeveloperLogEntry[]>("get_developer_logs")
    : invoke<DeveloperLogEntry[]>("get_developer_logs", { limit });
}

export async function getDeveloperLogSnapshot(limit?: number): Promise<DeveloperLogSnapshot> {
  return limit === undefined
    ? invoke<DeveloperLogSnapshot>("get_developer_log_snapshot")
    : invoke<DeveloperLogSnapshot>("get_developer_log_snapshot", { limit });
}

export async function selectDirectory(options: {
  defaultPath?: string
  buttonLabel?: string
  message?: string
} = {}): Promise<string | null> {
  const { defaultPath, buttonLabel, message } = options;
  return invoke<string | null>("select_directory", { defaultPath, buttonLabel, message });
}

export async function writeClipboardText(text: string): Promise<void> {
  return invoke("write_clipboard_text", { text });
}
