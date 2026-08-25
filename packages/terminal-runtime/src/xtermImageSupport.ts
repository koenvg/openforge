import { ImageAddon } from '@xterm/addon-image'
import type { Terminal } from '@xterm/xterm'
import {
  TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES,
  TERMINAL_IMAGE_PIXEL_LIMIT,
  TERMINAL_IMAGE_STORAGE_LIMIT_MB,
  createItermImageCompatibilityAddon,
  type TerminalImageProtocol,
} from './terminalImages'
import { terminalLogMessage } from './terminalLogging'

export interface XtermImageSupportOptions {
  terminal: Terminal
  enableImages?: boolean
  loggerName?: string
}

export interface XtermImageSupport {
  readonly protocol: TerminalImageProtocol | null
  reset(): void
}

const NO_IMAGE_SUPPORT: XtermImageSupport = { protocol: null, reset() {} }

export function loadXtermImageSupport({ terminal, enableImages, loggerName }: XtermImageSupportOptions): XtermImageSupport {
  if (enableImages === false) return NO_IMAGE_SUPPORT

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
      console.warn(terminalLogMessage(loggerName, 'Failed to dispose unavailable image addon:'), disposeError)
    }
    console.warn(terminalLogMessage(loggerName, 'Inline images unavailable; keeping text fallbacks:'), error)
    return NO_IMAGE_SUPPORT
  }

  const compatibilityAddon = createItermImageCompatibilityAddon()
  try {
    terminal.loadAddon(compatibilityAddon)
  } catch (error) {
    compatibilityAddon.dispose()
    try {
      imageAddon.dispose()
    } catch (disposeError) {
      console.warn(terminalLogMessage(loggerName, 'Failed to dispose unvalidated image addon:'), disposeError)
    }
    console.warn(terminalLogMessage(loggerName, 'Inline image validation unavailable; keeping text fallbacks:'), error)
    return NO_IMAGE_SUPPORT
  }

  return {
    protocol: 'iterm2',
    reset: () => imageAddon.reset(),
  }
}
