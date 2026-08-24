import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import {
  TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES,
  TERMINAL_IMAGE_PIXEL_LIMIT,
  TERMINAL_IMAGE_STORAGE_LIMIT_MB,
  createItermImageCompatibilityAddon,
  type TerminalImageProtocol,
} from './terminalImages'
import { createTerminalLinkHandler, loadTerminalWebLinksAddon } from './terminalLinks'
import { terminalLogMessage } from './terminalLogging'
import { getTerminalOptions } from './terminalOptions'
import type { PoolEntry, TerminalRuntimeHost } from './terminalRuntimeTypes'
import type { ThemeMode } from './theme'

function loadImageSupport(
  host: TerminalRuntimeHost,
  terminal: Terminal,
): { imageAddon: ImageAddon | null; imageProtocol: TerminalImageProtocol | null } {
  if (host.enableImages === false) return { imageAddon: null, imageProtocol: null }

  const imageAddon = new ImageAddon({
    enableSizeReports: true,
    pixelLimit: TERMINAL_IMAGE_PIXEL_LIMIT,
    storageLimit: TERMINAL_IMAGE_STORAGE_LIMIT_MB,
    showPlaceholder: true,
    sixelSupport: false,
    iipSupport: true,
    iipSizeLimit: TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES,
  })

  try {
    terminal.loadAddon(imageAddon)
  } catch (error) {
    try {
      imageAddon.dispose()
    } catch (disposeError) {
      console.warn(terminalLogMessage(host.loggerName, 'Failed to dispose unavailable image addon:'), disposeError)
    }
    console.warn(terminalLogMessage(host.loggerName, 'Inline images unavailable; keeping text fallbacks:'), error)
    return { imageAddon: null, imageProtocol: null }
  }

  const compatibilityAddon = createItermImageCompatibilityAddon()
  try {
    // Register after ImageAddon so validation and WebP conversion run first.
    terminal.loadAddon(compatibilityAddon)
    return { imageAddon, imageProtocol: 'iterm2' }
  } catch (error) {
    compatibilityAddon.dispose()
    try {
      imageAddon.dispose()
    } catch (disposeError) {
      console.warn(terminalLogMessage(host.loggerName, 'Failed to dispose unvalidated image addon:'), disposeError)
    }
    console.warn(terminalLogMessage(host.loggerName, 'Inline image validation unavailable; keeping text fallbacks:'), error)
    return { imageAddon: null, imageProtocol: null }
  }
}

function createHostDiv(): HTMLDivElement {
  const div = document.createElement('div')
  div.style.width = '100%'
  div.style.height = '100%'
  return div
}

export function createTerminalEntry(
  host: TerminalRuntimeHost,
  terminalKey: string,
  themeMode: ThemeMode,
): PoolEntry {
  const terminal = new Terminal({
    ...getTerminalOptions(themeMode),
    linkHandler: createTerminalLinkHandler(host, terminalKey),
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  loadTerminalWebLinksAddon(host, terminalKey, terminal)
  const imageSupport = loadImageSupport(host, terminal)

  return {
    taskId: terminalKey,
    loggerName: host.loggerName,
    terminal,
    fitAddon,
    hostDiv: createHostDiv(),
    ptyActive: false,
    needsClear: false,
    unlisteners: [],
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: false,
    spawnPending: false,
    currentPtyInstance: null,
    terminalStateSource: 'bootstrapping',
    terminalModelSequence: null,
    terminalModelRejectedInstance: null,
    pendingPtyOutput: [],
    pendingTerminalModelOutput: [],
    terminalModelRecovery: null,
    hasOutput: false,
    imageAddon: imageSupport.imageAddon,
    imageProtocol: imageSupport.imageProtocol,
    webglAddon: null,
    webglContextLossDisposable: null,
    webglUnavailable: false,
  }
}

export function resetTerminal(entry: PoolEntry): void {
  entry.imageAddon?.reset()
  entry.terminal.reset()
}

export function disposeWebglContextLossListener(entry: PoolEntry): void {
  try {
    entry.webglContextLossDisposable?.dispose()
  } catch (error) {
    console.warn(terminalLogMessage(entry.loggerName, 'Failed to dispose WebGL context loss listener:'), error)
  } finally {
    entry.webglContextLossDisposable = null
  }
}

function disposeWebglAddon(entry: PoolEntry): void {
  const webglAddon = entry.webglAddon
  disposeWebglContextLossListener(entry)
  entry.webglAddon = null

  try {
    webglAddon?.dispose()
  } catch (error) {
    console.warn(terminalLogMessage(entry.loggerName, 'Failed to dispose WebGL renderer addon:'), error)
  }
}

export function loadWebglAddon(entry: PoolEntry, onContextLoss?: () => void): void {
  if (entry.webglAddon || entry.webglUnavailable) return

  let webglAddon: WebglAddon | null = null
  try {
    webglAddon = new WebglAddon()
    entry.webglAddon = webglAddon
    entry.webglContextLossDisposable = webglAddon.onContextLoss(() => {
      if (!entry.webglAddon) return
      console.warn(terminalLogMessage(entry.loggerName, 'WebGL renderer context lost; falling back to the default renderer.'))
      disposeWebglAddon(entry)
      entry.webglUnavailable = true
      onContextLoss?.()
    })
    entry.terminal.loadAddon(webglAddon)
  } catch (error) {
    if (!entry.webglUnavailable) {
      if (entry.webglAddon) {
        disposeWebglAddon(entry)
      } else {
        try {
          webglAddon?.dispose()
        } catch (disposeError) {
          console.warn(terminalLogMessage(entry.loggerName, 'Failed to dispose unavailable WebGL renderer addon:'), disposeError)
        }
      }
      entry.webglAddon = null
      entry.webglContextLossDisposable = null
      entry.webglUnavailable = true
    }
    console.warn(terminalLogMessage(entry.loggerName, 'WebGL renderer unavailable; falling back to the default renderer:'), error)
  }
}
