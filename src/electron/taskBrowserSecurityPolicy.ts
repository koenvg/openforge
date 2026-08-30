import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { configureTaskBrowserDevToolsInteractions } from './taskBrowserDevTools.js'
import {
  DENY_TASK_BROWSER_PERMISSIONS,
  type ElectronTaskBrowserPermissionRouter,
} from './taskBrowserPermissionRouter.js'
import type { TaskBrowserSurfaceCreateOptions } from './taskBrowserSurfaceManager.js'

function allowedTopLevelUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function taskBrowserWebPreferences(options: TaskBrowserSurfaceCreateOptions) {
  return {
    ...options.webPreferences,
    partition: options.partition,
    devTools: true,
  }
}

type TaskBrowserSecurityPolicyCallbacks = {
  getAttachedWindow: () => BrowserWindow | null
  isDestroyed: () => boolean
  onMainFrameNavigation: () => void
  cancelVisibleRegionSelection: () => Promise<void>
}

export class TaskBrowserSecurityPolicy {
  private readonly childWindows = new Set<BrowserWindow>()

  constructor(
    private readonly mainContents: WebContents,
    private readonly options: TaskBrowserSurfaceCreateOptions,
    private readonly permissionRouter: ElectronTaskBrowserPermissionRouter,
    private readonly callbacks: TaskBrowserSecurityPolicyCallbacks,
  ) {
    this.configure(this.mainContents)
  }

  ownsWebContents(webContents: WebContents): boolean {
    return webContents === this.mainContents
      || Array.from(this.childWindows).some(window => !window.isDestroyed() && window.webContents === webContents)
  }

  destroy(): void {
    for (const childWindow of Array.from(this.childWindows)) {
      if (!childWindow.isDestroyed()) childWindow.destroy()
    }
    this.childWindows.clear()
  }

  private configure(contents: WebContents, ownerWindow: BrowserWindow | null = null): void {
    configureTaskBrowserDevToolsInteractions(contents, {
      getOwnerWindow: () => ownerWindow ?? this.callbacks.getAttachedWindow(),
      cancelVisibleRegionSelection: this.callbacks.cancelVisibleRegionSelection,
    })
    contents.on('will-navigate', (event, url) => {
      if (!allowedTopLevelUrl(url)) {
        event.preventDefault()
        return
      }
      if (contents === this.mainContents) this.callbacks.onMainFrameNavigation()
    })
    contents.on('will-redirect', (event, url) => {
      if (!allowedTopLevelUrl(url)) {
        event.preventDefault()
        return
      }
      if (contents === this.mainContents) this.callbacks.onMainFrameNavigation()
    })
    contents.setWindowOpenHandler(({ url, features }) => {
      if (!this.options.popupPolicy.isAllowed({ url, features })) return { action: 'deny' }
      const attachedWindow = this.callbacks.getAttachedWindow()
      return {
        action: 'allow',
        outlivesOpener: false,
        overrideBrowserWindowOptions: {
          ...(attachedWindow && !attachedWindow.isDestroyed()
            ? { parent: attachedWindow }
            : {}),
          autoHideMenuBar: true,
          webPreferences: taskBrowserWebPreferences(this.options),
        },
      }
    })
    contents.on('did-create-window', window => this.registerChildWindow(window))
  }

  private registerChildWindow(window: BrowserWindow): void {
    if (this.callbacks.isDestroyed() || window.webContents.session !== this.mainContents.session) {
      window.destroy()
      return
    }
    this.childWindows.add(window)
    this.permissionRouter.register(window.webContents, {
      windowId: this.options.windowId,
      handler: this.options.permissionHandler ?? DENY_TASK_BROWSER_PERMISSIONS,
    })
    window.on('closed', () => {
      this.childWindows.delete(window)
      this.permissionRouter.unregister(window.webContents)
    })
    this.configure(window.webContents, window)
  }
}
