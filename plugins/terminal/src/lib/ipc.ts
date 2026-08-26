import type { FrontendOpenForgeAPI, TerminalImageProtocol } from '@openforge-app/plugin-sdk/frontend'
import {
  parsePtySessionKey,
  type IndexedShellSessionKeyParts,
} from '@openforge-app/terminal-runtime'
import type { TaskWorkspaceInfo } from './types'

let terminalOpenForgeApi: FrontendOpenForgeAPI | null = null

export function setTerminalOpenForgeApi(api: FrontendOpenForgeAPI | null): void {
  terminalOpenForgeApi = api
}

export function getTerminalOpenForgeApi(): FrontendOpenForgeAPI {
  if (!terminalOpenForgeApi) {
    throw new Error('[terminal plugin] OpenForge frontend API is not initialized')
  }

  return terminalOpenForgeApi
}

function parseShellSessionKey(shellSessionKey: string): IndexedShellSessionKeyParts {
  const parsed = parsePtySessionKey(shellSessionKey)
  if (parsed.kind !== 'indexed-shell') {
    throw new Error(`[terminal plugin] Expected indexed Shell Session Key, received: ${shellSessionKey}`)
  }

  return { taskId: parsed.taskId, terminalIndex: parsed.terminalIndex }
}

export async function getConfig(key: string): Promise<string | null> {
  const value = await getTerminalOpenForgeApi().config.get<string>(key)
  return value ?? null
}

export async function setConfig(key: string, value: string): Promise<void> {
  await getTerminalOpenForgeApi().config.set(key, value)
}

export async function getTaskWorkspace(taskId: string): Promise<TaskWorkspaceInfo | null> {
  return getTerminalOpenForgeApi().tasks.getWorkspace(taskId)
}

export async function openTerminalLink(terminalKey: string, url: string): Promise<void> {
  const { taskId } = parseShellSessionKey(terminalKey)
  const api = getTerminalOpenForgeApi()
  if (taskId.startsWith('project-')) {
    await api.system.openUrl(url)
    return
  }
  await api.taskLinks.open({ taskId, url })
}

export async function spawnShellPty(
  taskId: string,
  cwd: string,
  cols: number,
  rows: number,
  terminalIndex: number,
  terminalImageProtocol: TerminalImageProtocol | null = null,
 ): Promise<number> {
  return getTerminalOpenForgeApi().shell.spawn({
    taskId,
    cwd,
    cols,
    rows,
    terminalIndex,
    terminalImageProtocol,
  })
}

export async function killPty(shellSessionKey: string): Promise<void> {
  await getTerminalOpenForgeApi().shell.kill(parseShellSessionKey(shellSessionKey))
}
