import type { BrowserWindow, Input, WebContents } from 'electron'

/**
 * The Task Browser page is its own WebContents, so its keystrokes never reach the
 * renderer's shortcut registry. Hand over the app shortcuts that must work from
 * anywhere by replaying them into the app window.
 */
export function forwardTaskBrowserAppShortcuts(
  contents: WebContents,
  getAppWindow: () => BrowserWindow | null,
): void {
  contents.on('before-input-event', (event, input) => {
    if (!isNewTaskShortcut(input)) return
    const appWindow = getAppWindow()
    if (!appWindow || appWindow.isDestroyed()) return
    event.preventDefault()
    appWindow.webContents.focus()
    appWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['meta'] })
    appWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers: ['meta'] })
  })
}

function isNewTaskShortcut(input: Input): boolean {
  return input.type === 'keyDown'
    && input.isAutoRepeat !== true
    && input.key.toLowerCase() === 'n'
    && input.meta === true
    && input.control !== true
    && input.alt !== true
    && input.shift !== true
}
