import { openUrl, writeClipboardText } from '../ipc'
import { defineDesktopEventListener } from './types'

export function createPluginSystemEventListeners() {
  return {
    openUrl: defineDesktopEventListener(
      'openforge.open-url',
      async (event) => openUrl(event.payload.url),
    ),
    writeClipboardText: defineDesktopEventListener(
      'openforge.write-clipboard-text',
      async (event) => writeClipboardText(event.payload.text),
    ),
  }
}
