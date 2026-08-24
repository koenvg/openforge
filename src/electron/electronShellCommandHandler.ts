import { developerLogStore } from './developerLogs.js'
import { payloadNumber, payloadString } from './ipcPayloadReaders.js'
import { openExternalUrl, openPathInEditor } from './shellCommands.js'
import type { ElectronInvokeDeps } from './backendBridge.js'

const ELECTRON_SHELL_COMMANDS = new Set([
  'open_url',
  'open_in_editor',
  'quit_app',
  'write_clipboard_text',
  'select_directory',
  'get_developer_log_snapshot',
  'get_developer_logs',
])

export function isElectronShellCommand(command: string): boolean {
  return ELECTRON_SHELL_COMMANDS.has(command)
}

export async function handleElectronShellCommand(
  command: string,
  payload: unknown,
  deps: ElectronInvokeDeps,
): Promise<unknown> {
  if (command === 'open_url') {
    const url = typeof (payload as { url?: unknown } | null)?.url === 'string'
      ? (payload as { url: string }).url
      : null
    if (!url) throw new Error('open_url requires a url payload')
    return openExternalUrl(url, deps.openExternal)
  }

  if (command === 'open_in_editor') {
    const path = typeof (payload as { path?: unknown } | null)?.path === 'string'
      ? (payload as { path: string }).path
      : null
    if (!path) throw new Error('open_in_editor requires a path payload')
    return openPathInEditor(path, deps.openExternal)
  }

  if (command === 'quit_app') {
    if (!deps.quitApp) throw new Error('quit_app is not available')
    await deps.quitApp()
    return undefined
  }

  if (command === 'write_clipboard_text') {
    if (!deps.writeClipboardText) throw new Error('write_clipboard_text is not available')
    const text = payloadString(payload, 'text')
    if (!text) throw new Error('write_clipboard_text requires a text payload')
    await deps.writeClipboardText(text)
    return undefined
  }

  if (command === 'select_directory') {
    if (!deps.selectDirectory) throw new Error('select_directory is not available')
    return deps.selectDirectory({
      defaultPath: payloadString(payload, 'defaultPath') ?? undefined,
      buttonLabel: payloadString(payload, 'buttonLabel') ?? undefined,
      message: payloadString(payload, 'message') ?? undefined,
    })
  }

  if (command === 'get_developer_log_snapshot') {
    const getDeveloperLogSnapshot = deps.getDeveloperLogSnapshot ?? ((limit?: number) => developerLogStore.getSnapshot(limit))
    return getDeveloperLogSnapshot(payloadNumber(payload, 'limit'))
  }

  if (command === 'get_developer_logs') {
    const getDeveloperLogs = deps.getDeveloperLogs ?? ((limit?: number) => developerLogStore.getRecentLogs(limit))
    return getDeveloperLogs(payloadNumber(payload, 'limit'))
  }

  throw new Error(`Electron shell command handler does not implement command: ${command}`)
}
