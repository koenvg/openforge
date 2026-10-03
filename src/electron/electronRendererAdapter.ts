import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, protocol, session } from 'electron'
import type { IpcMain } from 'electron'
import { createMainWindowOptions } from './windowConfig.js'
import { createPreloadPath } from './preloadPath.js'
import { loadAndRevealMainWindow } from './windowStartup.js'
import { FrontendHostRequestRelay } from './frontendHostRequestRelay.js'
import { FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND } from './frontendHostRequestProtocol.js'
import { ElectronRendererTrustAdapter } from './rendererTrustPolicy.js'
import { developerLogSink } from './developerLogs.js'
import { createAppEventForwarder } from './eventForwarder.js'
import { RendererEventSubscriptions, registerRendererEventSubscriptionHandler } from './rendererEventSubscriptions.js'
import { registerPluginProtocolHandler, resolveHostRuntimeRoot } from './pluginProtocol.js'
import type { ElectronBootAdapterOptions } from './electronBootAdapter.js'
import type { ElectronBackendAdapter } from './electronBackendAdapter.js'
import type { ElectronRestartAdapter } from './electronRestartAdapter.js'
import type { ElectronTaskBrowserAdapter } from './electronTaskBrowserAdapter.js'
import type { SidecarEventEnvelopeLike, SidecarEventStreamAdapter, SidecarLaunchConfig } from './sidecar.js'

/** Owns trusted renderer membership, native window teardown and host request/event routing. */
export class ElectronRendererAdapter {
  private readonly trust = new ElectronRendererTrustAdapter()
  private readonly subscriptions = new RendererEventSubscriptions()
  private readonly renderers = new Set<number>()
  private mainWindow: BrowserWindow | null = null
  private readonly relay: FrontendHostRequestRelay

  constructor(
    private readonly options: ElectronBootAdapterOptions,
    backend: ElectronBackendAdapter,
    private readonly restart: ElectronRestartAdapter,
    private readonly browser: ElectronTaskBrowserAdapter,
  ) {
    this.relay = new FrontendHostRequestRelay({
      acknowledgeSidecar: async acknowledgement => {
        if (!backend.available) return false
        return backend.invoke({ command: FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND, payload: acknowledgement })
      },
    })
  }

  hasRenderer(rendererId: number): boolean { return this.renderers.has(rendererId) }
  registerEventSubscriptions(ipc: IpcMain): void {
    registerRendererEventSubscriptionHandler(ipc, this.subscriptions, () => [...this.renderers])
  }
  acknowledge(rendererId: number, payload: unknown): Promise<boolean> { return this.relay.acknowledge(rendererId, payload) }
  shutdown(): void { void this.relay.shutdown() }

  registerPluginProtocolSchemeAsPrivileged(): void { this.trust.registerPluginProtocolSchemeAsPrivileged(protocol) }
  applyRendererCsp(config: SidecarLaunchConfig | null): void { this.trust.applyRendererCsp(session.defaultSession, config) }
  registerPluginProtocol(config: SidecarLaunchConfig | null): void {
    registerPluginProtocolHandler(protocol, {
      workspaceRoot: this.options.workspaceRoot, hostRuntimeRoot: resolveHostRuntimeRoot(this.options.currentDir),
      sidecarConfig: config, fetch: (url, init) => fetch(url, init),
    })
  }

  async createMainWindow(): Promise<BrowserWindow> {
    const ids = await (await this.restart.controlledWorkspace())?.launchWindowIds(this.options.env.OPENFORGE_E2E_RESTART_WINDOWS === '2' ? 2 : 1) ?? [randomUUID()]
    const windows: BrowserWindow[] = []
    for (const id of ids) windows.push(await this.createWorkspaceWindow(id))
    this.restart.installWorkspaceMenu()
    return windows[0]
  }

  private async createWorkspaceWindow(stableWindowId: string): Promise<BrowserWindow> {
    await this.browser.prepareWindow()
    const window = new BrowserWindow(createMainWindowOptions(createPreloadPath(this.options.currentDir)))
    this.mainWindow = window
    const rendererId = window.webContents.id
    this.renderers.add(rendererId)
    const unregisterRestartWindow = (await this.restart.controlledWorkspace())?.register(rendererId, stableWindowId, operationId => {
      window.webContents.send('openforge:event', { eventName: 'restart-workspace-capture', payload: { operationId } })
    })
    const unregisterBrowserWindow = this.browser.registerWindow(window)
    window.on('closed', () => {
      this.renderers.delete(rendererId)
      this.restart.forget(rendererId)
      unregisterRestartWindow?.()
      unregisterBrowserWindow()
      this.subscriptions.clear(rendererId)
      if (this.mainWindow === window) this.mainWindow = null
      void this.relay.rendererLost(rendererId)
    })

    const rendererUrl = this.trust.trustedRendererUrlFromEnv(this.options.env)
    const trustedOrigins = this.trust.trustedRendererOrigins(rendererUrl)
    window.on('focus', () => this.restart.focus(rendererId))
    window.webContents.on('did-frame-navigate', (_event, _url, _status, _statusText, isMainFrame) => {
      if (!isMainFrame) return
      this.restart.forget(rendererId)
      if (window.isFocused()) this.restart.focus(rendererId)
    })
    window.webContents.on('render-process-gone', () => {
      this.subscriptions.clear(rendererId)
      void this.relay.rendererLost(rendererId)
    })
    window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
      callback(this.trust.shouldGrantRendererPermission({
        permission, isMainWindowWebContents: webContents.id === rendererId,
        requestingUrl: details.requestingUrl, trustedOrigins,
        mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
      }))
    })

    developerLogSink.info(`[electron] Loading renderer from ${rendererUrl ?? 'packaged dist/index.html'}`)
    await loadAndRevealMainWindow(window, rendererUrl
      ? { rendererUrl }
      : { filePath: join(this.options.currentDir, '..', 'dist', 'index.html') }, {
      failureReporter: this.options.failureReporter,
    })
    return window
  }

  createEventStream(sidecarConfig: SidecarLaunchConfig): SidecarEventStreamAdapter {
    let eventListener: ((envelope: SidecarEventEnvelopeLike) => void) | null = null
    const forwarder = createAppEventForwarder({
      sidecarConfig, fetch: (url, init) => fetch(url, init),
      onEvent: envelope => {
        const renderer = this.mainWindow
          && !this.mainWindow.isDestroyed()
          && !this.mainWindow.webContents.isDestroyed()
          ? {
              id: this.mainWindow.webContents.id,
              send: (channel: string, payload: unknown) => this.mainWindow?.webContents.send(channel, payload),
            }
          : null
        if (this.relay.forward(envelope, renderer)) return false
        this.browser.onEvent(envelope)
        eventListener?.(envelope)
        this.browser.drainAfterEvent(envelope)
      },
      windows: envelope => BrowserWindow.getAllWindows().filter(window => this.subscriptions.has(window.webContents.id, envelope.eventName)),
      failureReporter: this.options.failureReporter,
    })
    return {
      ...forwarder,
      onEvent(listener: (envelope: SidecarEventEnvelopeLike) => void): void { eventListener = listener },
    }
  }
}
