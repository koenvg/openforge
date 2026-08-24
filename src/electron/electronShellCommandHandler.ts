import { developerLogStore } from './developerLogs.js'
import { openExternalUrl, openPathInEditor } from './shellCommands.js'
import type { ElectronInvokeDeps } from './backendBridge.js'

type ElectronShellCommandHandler = (
  payload: unknown,
  deps: ElectronInvokeDeps,
) => unknown | Promise<unknown>

const electronShellCommandHandlers = {
  open_url: (payload, deps) => {
    const url = typeof (payload as { url?: unknown } | null)?.url === 'string'
      ? (payload as { url: string }).url
      : null
    if (!url) throw new Error('open_url requires a url payload')
    return openExternalUrl(url, deps.openExternal)
  },
  open_in_editor: (payload, deps) => {
    const path = typeof (payload as { path?: unknown } | null)?.path === 'string'
      ? (payload as { path: string }).path
      : null
    if (!path) throw new Error('open_in_editor requires a path payload')
    return openPathInEditor(path, deps.openExternal)
  },
  quit_app: async (_payload, deps) => {
    if (!deps.quitApp) throw new Error('quit_app is not available')
    await deps.quitApp()
    return undefined
  },
  write_clipboard_text: async (payload, deps) => {
    if (!deps.writeClipboardText) throw new Error('write_clipboard_text is not available')
    const text = payloadString(payload, 'text')
    if (!text) throw new Error('write_clipboard_text requires a text payload')
    await deps.writeClipboardText(text)
    return undefined
  },
  select_directory: (payload, deps) => {
    if (!deps.selectDirectory) throw new Error('select_directory is not available')
    return deps.selectDirectory({
      defaultPath: payloadString(payload, 'defaultPath') ?? undefined,
      buttonLabel: payloadString(payload, 'buttonLabel') ?? undefined,
      message: payloadString(payload, 'message') ?? undefined,
    })
  },
  get_developer_log_snapshot: (payload, deps) => {
    const getDeveloperLogSnapshot = deps.getDeveloperLogSnapshot
      ?? ((limit?: number) => developerLogStore.getSnapshot(limit))
    return getDeveloperLogSnapshot(payloadNumber(payload, 'limit'))
  },
  get_developer_logs: (payload, deps) => {
    const getDeveloperLogs = deps.getDeveloperLogs
      ?? ((limit?: number) => developerLogStore.getRecentLogs(limit))
    return getDeveloperLogs(payloadNumber(payload, 'limit'))
  },
} satisfies Record<string, ElectronShellCommandHandler>

type ElectronShellCommand = keyof typeof electronShellCommandHandlers

export function isElectronShellCommand(command: string): command is ElectronShellCommand {
  return Object.hasOwn(electronShellCommandHandlers, command)
}

function payloadString(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function payloadNumber(payload: unknown, key: string): number | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export async function handleElectronShellCommand(
  command: string,
  payload: unknown,
  deps: ElectronInvokeDeps,
): Promise<unknown> {
  if (!isElectronShellCommand(command)) {
    throw new Error(`Electron shell command handler does not implement command: ${command}`)
  }

  return electronShellCommandHandlers[command](payload, deps)
}
