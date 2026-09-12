import type { TerminalImageProtocol, TerminalResizeAttachment } from '@openforge-app/terminal-runtime'
import { invokeDesktopCommand as invoke } from '../desktopIpc'
import type { DesktopPtyBufferState } from '../desktopTerminalTransport'
import type { RestartTerminalFence, RestartTerminalInventory } from '../../electron/restartWorkspace'

export async function getRestartTerminalInventory(): Promise<RestartTerminalInventory> {
  return invoke('get_restart_terminal_inventory')
}

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

// HTTP command dispatch can reorder concurrent requests, even when IPC sends them
// in order. Keep one write in flight per shell, without blocking other terminals.
const pendingWrites = new Map<string, Promise<void>>()

export async function writePty(shellSessionKey: string, data: string, fence?: RestartTerminalFence): Promise<void> {
  const identity = fence ? { ...fence, controller: { ...fence.controller } } : undefined
  const send = () => identity
    ? invoke<void>('pty_write', { shellSessionKey, data, fence: identity })
    : invoke<void>('pty_write', { shellSessionKey, data })
  const previous = pendingWrites.get(shellSessionKey)
  const write = previous ? previous.then(send) : send()
  // A failed write is reported to its caller, never retried, and does not poison
  // later input. Retain the enqueue-time fence so a restart cannot retarget it.
  const settled = write.then(() => {}, () => {})
  pendingWrites.set(shellSessionKey, settled)
  void settled.then(() => {
    if (pendingWrites.get(shellSessionKey) === settled) pendingWrites.delete(shellSessionKey)
  })
  await write
}


export async function resizePty(shellSessionKey: string, cols: number, rows: number, fence?: RestartTerminalFence, attachment?: TerminalResizeAttachment): Promise<void> {
  if (fence && attachment) return invoke('pty_resize', { shellSessionKey, cols, rows, fence, attachment })
  if (fence) return invoke('pty_resize', { shellSessionKey, cols, rows, fence })
  return invoke("pty_resize", { shellSessionKey, cols, rows });
}

export async function killPty(shellSessionKey: string, fence?: RestartTerminalFence): Promise<void> {
  if (fence) return invoke('pty_kill', { shellSessionKey, fence })
  return invoke("pty_kill", { shellSessionKey });
}

export async function killShellsForTask(taskId: string): Promise<void> {
  return invoke("pty_kill_shells_for_task", { taskId });
}

export async function getPtyBuffer(shellSessionKey: string, fence?: RestartTerminalFence): Promise<DesktopPtyBufferState> {
  if (fence) return invoke('get_pty_buffer', { shellSessionKey, fence })
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
