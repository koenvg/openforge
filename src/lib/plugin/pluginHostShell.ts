import type { ShellSpawnRequest } from '@openforge-app/plugin-sdk'
import { createIndexedShellSessionKey } from '@openforge-app/terminal-runtime'
import {
  getPtyBuffer,
  killPty,
  resizePty,
  spawnShellPty,
  writePty,
  writeTerminalQueryResponse,
} from '../ipc'
import type { PluginHostCommandEntries, PluginHostCommandPayload } from './pluginHostCommandRegistry'
import { waitForTerminalEventSubscriptions } from './pluginHostEvents'
import type { RuntimeHostBridge } from './runtimeContributionTypes'

type ShellHostCapabilities = Required<Pick<RuntimeHostBridge,
  'spawnShell' | 'writeShell' | 'writeTerminalQueryResponse' | 'resizeShell' | 'killShell' | 'getShellBuffer'
>>

type ShellSessionRequest = { taskId: string; terminalIndex: number }

function shellSessionKey(request: ShellSessionRequest): string {
  if (!request.taskId) {
    throw new Error('shell callback requires taskId')
  }
  if (!Number.isInteger(request.terminalIndex) || request.terminalIndex < 0) {
    throw new Error('shell callback requires a non-negative integer terminalIndex')
  }
  return createIndexedShellSessionKey(request)
}

function shellSessionFromPayload(payload: PluginHostCommandPayload): ShellSessionRequest {
  const terminalIndex = payload?.terminalIndex
  if (typeof terminalIndex !== 'number') {
    throw new Error('shell callback requires a non-negative integer terminalIndex')
  }

  return {
    taskId: String(payload?.taskId ?? ''),
    terminalIndex,
  }
}

async function spawnShell(request: ShellSpawnRequest) {
  await waitForTerminalEventSubscriptions(request)
  return spawnShellPty(
    request.taskId,
    request.cwd,
    request.cols,
    request.rows,
    request.terminalIndex,
    request.terminalImageProtocol ?? null,
  )
}

function writeShell(request: ShellSessionRequest & { data: string }) {
  return writePty(shellSessionKey(request), request.data)
}

function writeShellTerminalQueryResponse(
  request: ShellSessionRequest & { ptyInstanceId: number; data: string },
) {
  return writeTerminalQueryResponse({
    shellSessionKey: shellSessionKey(request),
    ptyInstanceId: request.ptyInstanceId,
    data: request.data,
  })
}

function resizeShell(request: ShellSessionRequest & { cols: number; rows: number }) {
  return resizePty(shellSessionKey(request), request.cols, request.rows)
}

function killShell(request: ShellSessionRequest) {
  return killPty(shellSessionKey(request))
}

function getShellBuffer(request: ShellSessionRequest) {
  return getPtyBuffer(shellSessionKey(request))
}

export function createPluginShellHostCapabilities(): ShellHostCapabilities {
  return {
    spawnShell,
    writeShell,
    writeTerminalQueryResponse: writeShellTerminalQueryResponse,
    resizeShell,
    killShell,
    getShellBuffer,
  }
}

export const shellCommandHandlers: PluginHostCommandEntries = [
  ['spawnShellPty', (payload) => spawnShell({
    taskId: String(payload?.taskId ?? ''),
    cwd: String(payload?.cwd ?? ''),
    cols: Number(payload?.cols),
    rows: Number(payload?.rows),
    terminalIndex: Number(payload?.terminalIndex),
    terminalImageProtocol: payload?.terminalImageProtocol === 'iterm2' ? 'iterm2' : undefined,
  })],
  ['writePty', (payload) => writeShell({
    ...shellSessionFromPayload(payload),
    data: String(payload?.data ?? ''),
  })],
  ['resizePty', (payload) => resizeShell({
    ...shellSessionFromPayload(payload),
    cols: Number(payload?.cols),
    rows: Number(payload?.rows),
  })],
  ['killPty', (payload) => killShell(shellSessionFromPayload(payload))],
  ['getPtyBuffer', (payload) => getShellBuffer(shellSessionFromPayload(payload))],
]
