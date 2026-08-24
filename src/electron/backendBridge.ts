import { handleElectronShellCommand, isElectronShellCommand } from './electronShellCommandHandler.js'
import { forwardToSidecarWithRepositoryAccessRecovery } from './repositoryAccessRecovery.js'
import { isSidecarBackedCommand } from './rustSidecarForwarder.js'
import type { DeveloperLogEntry, DeveloperLogSnapshot } from './developerLogs.js'
import type { SidecarLaunchConfig } from './sidecar.js'

export { isSidecarBackedCommand } from './rustSidecarForwarder.js'

export interface ElectronInvokeRequest {
  command?: unknown
  payload?: unknown
}

export interface BridgeResponseLike {
  ok: boolean
  status?: number
  json(): Promise<unknown>
  text?(): Promise<string>
}

export type BridgeFetch = (url: string, init: {
  method: 'POST'
  headers: Record<string, string>
  body: string
}) => Promise<BridgeResponseLike>

export type OpenExternal = (url: string) => Promise<void>
export type GetApplicationNameForProtocol = (url: string) => string
export type QuitApp = () => void | Promise<void>
export type WriteClipboardText = (text: string) => void | Promise<void>
export type SelectDirectory = (options: {
  defaultPath?: string
  buttonLabel?: string
  message?: string
}) => Promise<string | null>
export type GetDeveloperLogs = (limit?: number) => DeveloperLogEntry[]
export type GetDeveloperLogSnapshot = (limit?: number) => DeveloperLogSnapshot

export interface ElectronInvokeDeps {
  sidecarConfig: SidecarLaunchConfig | null
  fetch: BridgeFetch
  openExternal: OpenExternal
  getApplicationNameForProtocol?: GetApplicationNameForProtocol
  quitApp?: QuitApp
  writeClipboardText?: WriteClipboardText
  selectDirectory?: SelectDirectory
  getDeveloperLogs?: GetDeveloperLogs
  getDeveloperLogSnapshot?: GetDeveloperLogSnapshot
}

function commandFromRequest(request: ElectronInvokeRequest): string {
  if (typeof request !== 'object' || request === null || typeof request.command !== 'string') {
    throw new Error('invalid Open Forge IPC request')
  }
  return request.command
}

export async function handleElectronInvoke(request: ElectronInvokeRequest, deps: ElectronInvokeDeps): Promise<unknown> {
  const command = commandFromRequest(request)
  const payload = request.payload ?? null

  if (isElectronShellCommand(command)) {
    return handleElectronShellCommand(command, payload, deps)
  }

  if (isSidecarBackedCommand(command)) {
    return forwardToSidecarWithRepositoryAccessRecovery(command, payload, deps)
  }

  throw new Error(`Electron backend bridge is not implemented for command: ${command}`)
}
