import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { handleElectronInvoke } from './backendBridge.js'
import type { ElectronInvokeDeps, ElectronInvokeRequest } from './backendBridge.js'
import type { BootBackendInvokeContext } from './bootLifecycle.js'
import { developerLogStore } from './developerLogs.js'
import { forwardToSidecar } from './rustSidecarForwarder.js'
import { FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND } from './frontendHostRequestProtocol.js'
import { isTaskBrowserSurfaceCommand } from './taskBrowserSurfaceIpc.js'
import type { ElectronRendererAdapter } from './electronRendererAdapter.js'
import type { ElectronRestartAdapter } from './electronRestartAdapter.js'
import type { ElectronTaskBrowserAdapter } from './electronTaskBrowserAdapter.js'

/** Host-only backend context and shell capabilities. Context retirement never changes renderer IPC authority. */
export class ElectronBackendAdapter {
  private context: BootBackendInvokeContext | null = null

  clear(): void { this.context = null }
  get available(): boolean { return this.context !== null }
  get hasSidecar(): boolean { return Boolean(this.context?.getSidecarConfig()) }

  invoke(request: ElectronInvokeRequest, unavailable = 'Rust sidecar is not available'): Promise<unknown> {
    if (!this.context) throw new Error(unavailable)
    return handleElectronInvoke(request, this.createInvokeDeps(this.context))
  }

  async forward(command: string, payload: unknown): Promise<void> {
    if (!this.context) throw new Error('Restart backend is not ready')
    await forwardToSidecar(command, payload, this.createInvokeDeps(this.context))
  }

  register(context: BootBackendInvokeContext, owners: {
    renderer: ElectronRendererAdapter
    restart: ElectronRestartAdapter
    browser: ElectronTaskBrowserAdapter
  }): void {
    this.context = context
    const { renderer, restart, browser } = owners
    renderer.registerEventSubscriptions(ipcMain)
    ipcMain.handle('openforge:invoke', async (event, request: unknown) => {
      const typedRequest = request as ElectronInvokeRequest
      if (typedRequest.command === FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND) {
        return renderer.acknowledge(event.sender.id, typedRequest.payload)
      }
      if (typeof typedRequest.command === 'string' && isTaskBrowserSurfaceCommand(typedRequest.command)) {
        const owningWindow = BrowserWindow.fromWebContents(event.sender)
        const windowId = owningWindow && owningWindow.webContents.id === event.sender.id ? owningWindow.id : null
        return browser.handle(typedRequest.command, typedRequest.payload, windowId)
      }
      if (typedRequest.command === 'pty_resize' && typedRequest.payload && typeof typedRequest.payload === 'object' && 'attachment' in typedRequest.payload) {
        return restart.resize(event, typedRequest.payload, payload => handleElectronInvoke(
          { command: 'pty_resize', payload }, this.createInvokeDeps(context),
        ))
      }
      return browser.invokeWithPurgeDrain(typedRequest, () => handleElectronInvoke(typedRequest, {
        ...this.createInvokeDeps(context),
        restartWorkspace: (command, payload) => restart.handleWorkspace(event, command, payload),
      }))
    })
  }

  private createInvokeDeps(context: BootBackendInvokeContext): ElectronInvokeDeps {
    return {
      sidecarConfig: context.getSidecarConfig(),
      fetch: (url, init) => fetch(url, init),
      openExternal: (url) => shell.openExternal(url),
      getApplicationNameForProtocol: (url) => app.getApplicationNameForProtocol(url),
      quitApp: () => app.quit(),
      writeClipboardText: (text) => clipboard.writeText(text),
      selectDirectory: async ({ defaultPath, buttonLabel, message }) => {
        const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
        const dialogOptions: OpenDialogOptions = {
          properties: ['openDirectory'], defaultPath, buttonLabel, message,
        }
        const result = window
          ? await dialog.showOpenDialog(window, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions)
        return result.canceled ? null : result.filePaths[0] ?? null
      },
      getDeveloperLogs: (limit) => developerLogStore.getRecentLogs(limit),
      getDeveloperLogSnapshot: (limit) => developerLogStore.getSnapshot(limit),
    }
  }
}
