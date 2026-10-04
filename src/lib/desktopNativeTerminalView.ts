import { createXtermTerminalView, parsePtySessionKey, type TerminalViewFactory } from '@openforge-app/terminal-runtime'
import { listenDesktopEvent } from './desktopIpc'
import { nativeTerminalCommand } from './ipc'
import { createNativeTerminalView, type NativeTerminalPort } from './nativeTerminalView'

export function usesExperimentalNativeTerminal(terminalKey: string): boolean {
  if (!import.meta.env.DEV || terminalKey !== import.meta.env.VITE_OPENFORGE_EXPERIMENTAL_GHOSTTY_SESSION) return false
  return parsePtySessionKey(terminalKey).kind === 'indexed-shell'
}

function nativePort(): NativeTerminalPort {
  return {
    create: nativeTerminalCommand,
    write: nativeTerminalCommand,
    bounds: nativeTerminalCommand,
    focus: nativeTerminalCommand,
    hide: nativeTerminalCommand,
    destroy: nativeTerminalCommand,
    onInput: listener => listenDesktopEvent('experimental-native-terminal-input', event => listener(event.payload)),
  }
}

export const createDesktopTerminalView: TerminalViewFactory = options => usesExperimentalNativeTerminal(options.terminalKey)
  ? createNativeTerminalView(options, nativePort(), createXtermTerminalView)
  : createXtermTerminalView(options)
