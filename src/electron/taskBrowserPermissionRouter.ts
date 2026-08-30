import type { Session, WebContents } from 'electron'
import type { TaskBrowserPermissionSessionHandler } from './taskBrowserPermissionPolicy.js'

export const DENY_TASK_BROWSER_PERMISSIONS: TaskBrowserPermissionSessionHandler = {
  check: () => false,
  request: async () => false,
}

type PermissionOwner = {
  windowId: number
  handler: TaskBrowserPermissionSessionHandler
}

export class ElectronTaskBrowserPermissionRouter {
  private readonly owners = new Map<WebContents, PermissionOwner>()

  constructor(browserSession: Session) {
    browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      if (!webContents) return false
      const owner = this.owners.get(webContents)
      if (!owner) return false
      try {
        return owner.handler.check({ permission, requestingOrigin, details })
      } catch {
        return false
      }
    })
    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const owner = this.owners.get(webContents)
      if (!owner) {
        callback(false)
        return
      }
      try {
        void owner.handler.request({ windowId: owner.windowId, permission, details })
          .then(decision => callback(decision === true), () => callback(false))
      } catch {
        callback(false)
      }
    })
  }

  register(webContents: WebContents, owner: PermissionOwner): void {
    this.owners.set(webContents, owner)
  }

  unregister(webContents: WebContents): void {
    this.owners.delete(webContents)
  }
}

const taskBrowserPermissionRouters = new WeakMap<Session, ElectronTaskBrowserPermissionRouter>()

export function permissionRouterFor(browserSession: Session): ElectronTaskBrowserPermissionRouter {
  let router = taskBrowserPermissionRouters.get(browserSession)
  if (!router) {
    router = new ElectronTaskBrowserPermissionRouter(browserSession)
    taskBrowserPermissionRouters.set(browserSession, router)
  }
  return router
}
