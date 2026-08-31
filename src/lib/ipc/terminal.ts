import type { TerminalImageProtocol } from '@openforge-app/terminal-runtime'
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

const E2E_FIXTURE_MARKER = /^[A-Za-z0-9_.:-]{1,64}$/
const MAX_E2E_FIXTURE_OUTPUT_BYTES = 64 * 1024 * 1024

export interface E2eTerminalFixtureOutputReceipt {
  shellSessionKey: string
  marker: string
  byteCount: number
  ptyInstanceId: number
}

export async function emitTerminalFixtureOutput(
  shellSessionKey: string,
  marker: string,
  byteCount: number,
): Promise<E2eTerminalFixtureOutputReceipt> {
  if (!E2E_FIXTURE_MARKER.test(marker)) {
    throw new Error('marker must contain 1-64 ASCII letters, digits, hyphens, underscores, periods, or colons')
  }
  if (!Number.isSafeInteger(byteCount) || byteCount < 0 || byteCount > MAX_E2E_FIXTURE_OUTPUT_BYTES) {
    throw new Error(`byteCount must be an integer between 0 and ${MAX_E2E_FIXTURE_OUTPUT_BYTES}`)
  }
  return invoke<E2eTerminalFixtureOutputReceipt>('e2e_emit_terminal_fixture', {
    shellSessionKey,
    marker,
    byteCount,
  })
}
