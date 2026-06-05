import type { Disposable, FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
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

export async function openUrl(url: string): Promise<void> {
  await getTerminalOpenForgeApi().system.openUrl(url)
}

export async function spawnShellPty(taskId: string, cwd: string, cols: number, rows: number, terminalIndex: number): Promise<number> {
  return getTerminalOpenForgeApi().shell.spawn({ taskId, cwd, cols, rows, terminalIndex })
}

export async function writePty(taskId: string, data: string): Promise<void> {
  await getTerminalOpenForgeApi().shell.write({ taskId, data })
}

export async function resizePty(taskId: string, cols: number, rows: number): Promise<void> {
  await getTerminalOpenForgeApi().shell.resize({ taskId, cols, rows })
}

export async function killPty(taskId: string): Promise<void> {
  await getTerminalOpenForgeApi().shell.kill({ taskId })
}

export async function getPtyBuffer(taskId: string): Promise<string | null> {
  return getTerminalOpenForgeApi().shell.getBuffer({ taskId })
}
