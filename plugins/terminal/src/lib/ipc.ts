import type { Disposable, FrontendOpenForgeAPI, PtyBufferState, TerminalImageProtocol } from '@openforge-app/plugin-sdk/frontend'
import type { TerminalQueryResponseWrite } from '@openforge-app/terminal-runtime'
import type { TaskWorkspaceInfo } from './types'

let terminalOpenForgeApi: FrontendOpenForgeAPI | null = null

export type OpenForgeEventUnlistenFn = () => void

export function setTerminalOpenForgeApi(api: FrontendOpenForgeAPI | null): void {
  terminalOpenForgeApi = api
}

function getTerminalOpenForgeApi(): FrontendOpenForgeAPI {
  if (!terminalOpenForgeApi) {
    throw new Error('[terminal plugin] OpenForge frontend API is not initialized')
  }

  return terminalOpenForgeApi
}

function toUnlisten(disposable: Disposable): OpenForgeEventUnlistenFn {
  return () => {
    void disposable.dispose()
  }
}

function parseIndexedTerminalKey(terminalKey: string): { taskId: string; terminalIndex: number } {
  const match = /^(.*)-shell-(\d+)$/.exec(terminalKey)
  if (!match || !match[1]) {
    throw new Error(`[terminal plugin] Expected indexed terminal key, received: ${terminalKey}`)
  }

  return { taskId: match[1], terminalIndex: Number(match[2]) }
}

export async function listenOpenForgeEvent<TPayload>(eventName: string, handler: (event: { payload: TPayload }) => void): Promise<OpenForgeEventUnlistenFn> {
  const disposable = getTerminalOpenForgeApi().events.onGlobal<TPayload>(`openforge.${eventName}`, (payload) => {
    handler({ payload })
  })

  return toUnlisten(disposable)
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
  const { taskId } = parseIndexedTerminalKey(terminalKey)
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

export async function writePty(taskId: string, data: string): Promise<void> {
  await getTerminalOpenForgeApi().shell.write({ ...parseIndexedTerminalKey(taskId), data })
}

export async function writeTerminalQueryResponse(
  response: TerminalQueryResponseWrite,
): Promise<void> {
  await getTerminalOpenForgeApi().shell.writeTerminalQueryResponse({
    ...parseIndexedTerminalKey(response.shellSessionKey),
    ptyInstanceId: response.ptyInstanceId,
    data: response.data,
  })
}

export async function resizePty(taskId: string, cols: number, rows: number): Promise<void> {
  await getTerminalOpenForgeApi().shell.resize({ ...parseIndexedTerminalKey(taskId), cols, rows })
}

export async function killPty(taskId: string): Promise<void> {
  await getTerminalOpenForgeApi().shell.kill(parseIndexedTerminalKey(taskId))
}

export async function getPtyBuffer(taskId: string): Promise<PtyBufferState> {
  return getTerminalOpenForgeApi().shell.getBuffer(parseIndexedTerminalKey(taskId))
}
