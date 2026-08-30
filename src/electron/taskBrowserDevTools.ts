import { classifyTaskBrowserDevToolsShortcut } from '@openforge-app/plugin-sdk/taskBrowserDevToolsShortcuts'
import { Menu } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { TaskBrowserSurfaceError } from './taskBrowserSurfaceManager.js'
import type { TaskBrowserDevToolsPanel } from './taskBrowserSurfaceManager.js'

const DEVTOOLS_OPEN_TIMEOUT_MS = 2_000

function devToolsPanelInput(panel: TaskBrowserDevToolsPanel) {
  const modifiers: Array<'control' | 'shift' | 'alt' | 'meta'> = process.platform === 'darwin'
    ? panel === 'elements'
      ? ['meta', 'shift']
      : ['meta', 'alt']
    : ['control', 'shift']
  return {
    type: 'keyDown' as const,
    keyCode: panel === 'elements' ? 'C' : 'J',
    modifiers,
  }
}

export async function openTaskBrowserDevTools(
  contents: WebContents,
  panel?: TaskBrowserDevToolsPanel,
): Promise<void> {
  if (!contents.isDevToolsOpened()) {
    await new Promise<void>((resolve, reject) => {
      const opened = () => {
        clearTimeout(timeout)
        contents.removeListener('devtools-opened', opened)
        resolve()
      }
      const timeout = setTimeout(() => {
        contents.removeListener('devtools-opened', opened)
        reject(new TaskBrowserSurfaceError(
          'HOST_UNAVAILABLE',
          'Chromium Developer Tools did not open',
        ))
      }, DEVTOOLS_OPEN_TIMEOUT_MS)
      contents.on('devtools-opened', opened)
      try {
        contents.openDevTools()
        if (contents.isDevToolsOpened()) opened()
      } catch (error) {
        clearTimeout(timeout)
        contents.removeListener('devtools-opened', opened)
        reject(error)
      }
    })
  }
  if (panel) contents.devToolsWebContents?.sendInputEvent(devToolsPanelInput(panel))
}

type TaskBrowserDevToolsInteractionsOptions = {
  getOwnerWindow: () => BrowserWindow | null
  cancelVisibleRegionSelection: () => Promise<void>
}

export function configureTaskBrowserDevToolsInteractions(
  contents: WebContents,
  options: TaskBrowserDevToolsInteractionsOptions,
): void {
  const runAfterCancelingSelection = (action: () => void) => {
    void options.cancelVisibleRegionSelection().then(action)
  }

  contents.on('before-input-event', (event, input) => {
    const shortcut = classifyTaskBrowserDevToolsShortcut(
      process.platform === 'darwin' ? 'macos' : 'other',
      {
        key: input.key.toLowerCase(),
        keyDown: input.type === 'keyDown',
        repeat: input.isAutoRepeat === true,
        control: input.control === true,
        shift: input.shift === true,
        alt: input.alt === true,
        meta: input.meta === true,
      },
    )
    if (shortcut === null) return
    event.preventDefault()
    if (shortcut !== 'toggle') {
      runAfterCancelingSelection(() => {
        void openTaskBrowserDevTools(contents, shortcut)
      })
    } else if (contents.isDevToolsOpened()) {
      contents.closeDevTools()
    } else {
      runAfterCancelingSelection(() => {
        void openTaskBrowserDevTools(contents)
      })
    }
  })

  contents.on('context-menu', (_event, params) => {
    const menu = Menu.buildFromTemplate([{
      label: 'Inspect element',
      click: () => runAfterCancelingSelection(
        () => contents.inspectElement(params.x, params.y),
      ),
    }])
    const window = options.getOwnerWindow()
    menu.popup(window && !window.isDestroyed() ? { window } : {})
  })
}
