import { writeClipboardText } from '../ipc'
import { defineDesktopEventListener } from './types'

export function createPluginSystemEventListeners() {
  return {
    writeClipboardText: defineDesktopEventListener<{ text: string }>(
      'openforge.write-clipboard-text',
      async (event) => writeClipboardText(event.payload.text),
    ),
  }
}
