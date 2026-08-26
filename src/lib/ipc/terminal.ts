import type { TerminalImageProtocol, TerminalQueryResponseWrite } from '@openforge-app/terminal-runtime'
import { invokeDesktopCommand as invoke } from '../desktopIpc'
import type { DesktopPtyBufferState } from '../desktopTerminalTransport'

export async function spawnShellPty(
  taskId: string,
  cwd: string,
  cols: number,
  rows: number,
  terminalIndex: number,
  terminalImageProtocol: TerminalImageProtocol | null = null,
): Promise<number> {
  return invoke<number>("pty_spawn_shell", {
    taskId,
    cwd,
    cols,
    rows,
    terminalIndex,
    terminalImageProtocol,
  });
}

export async function writePty(shellSessionKey: string, data: string): Promise<void> {
  return invoke("pty_write", { shellSessionKey, data });
}

export async function writeTerminalQueryResponse(
  response: TerminalQueryResponseWrite,
): Promise<void> {
  return invoke('pty_write_terminal_query_response', {
    shellSessionKey: response.shellSessionKey,
    ptyInstanceId: response.ptyInstanceId,
    data: response.data,
  })
}

export async function resizePty(shellSessionKey: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { shellSessionKey, cols, rows });
}

export async function killPty(shellSessionKey: string): Promise<void> {
  return invoke("pty_kill", { shellSessionKey });
}

export async function killShellsForTask(taskId: string): Promise<void> {
  return invoke("pty_kill_shells_for_task", { taskId });
}

export async function getPtyBuffer(shellSessionKey: string): Promise<DesktopPtyBufferState> {
  return invoke<DesktopPtyBufferState>("get_pty_buffer", { shellSessionKey });
}
