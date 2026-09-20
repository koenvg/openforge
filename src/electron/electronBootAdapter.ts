import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { RestartWorkspaceIpc } from './restartWorkspaceIpc.js'
import { createControlledRestartHost } from './controlledRestartHost.js'
import { installRestartMenu } from './restartMenu.js'
import { RestartGeometryLeases } from './restartGeometryLeases.js'
import type { RestartAttachmentIdentity } from './restartGeometryLeases.js'
import type { RestartTerminalFence, RestartTerminalInventory } from './restartWorkspace.js'
import { join } from 'node:path'
import { BrowserWindow, app, clipboard, dialog, ipcMain, protocol, session, shell } from 'electron'
import { FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND } from './frontendHostRequestProtocol.js'
import {
  ACKNOWLEDGE_BROWSER_SESSION_PURGE_INTENT_COMMAND,
  LIST_BROWSER_SESSION_PURGE_INTENTS_COMMAND,
} from './internalSidecarCommandRegistrations.js'
import { handleElectronInvoke } from './backendBridge.js'
import { forwardToSidecar } from './rustSidecarForwarder.js'
import { FileTaskBrowserCaptureArtifactStore } from './taskBrowserCaptureArtifactStore.js'
import { FileTaskBrowserPartitionRegistry } from './taskBrowserPartitionRegistry.js'
import { TaskBrowserPermissionPolicy } from './taskBrowserPermissionPolicy.js'
import { taskBrowserPermissionPromptOptions } from './taskBrowserPermissionPrompt.js'
import { FileTaskBrowserPermissionStore } from './taskBrowserPermissionStore.js'
import {
  TaskBrowserSessionPurgeCoordinator,
  invokeWithTaskBrowserSessionPurgeDrain,
} from './taskBrowserSessionPurgeCoordinator.js'
import { purgeSupersededTaskBrowserPartitions } from './supersededTaskBrowserPartitionCleanup.js'
import {
  createPluginBrowserSessionAuthorizer,
  createTaskBrowserSurfaceAuthorizer,
} from './taskBrowserSurfaceAuthorization.js'
import { ElectronTaskBrowserSurfaceFactory, electronRendererZoomFactor } from './taskBrowserSurfaceElectronAdapter.js'
import { TaskBrowserSurfaceIpcRouter, isTaskBrowserSurfaceCommand } from './taskBrowserSurfaceIpc.js'
import { TaskBrowserSurfaceManager } from './taskBrowserSurfaceManager.js'
import { handleTaskBrowserSurfaceLifecycleEvent } from './taskBrowserSurfaceLifecycle.js'
import { createMainWindowOptions } from './windowConfig.js'
import { createPreloadPath } from './preloadPath.js'
import { loadAndRevealMainWindow } from './windowStartup.js'
import { FrontendHostRequestRelay } from './frontendHostRequestRelay.js'
import { ElectronRendererTrustAdapter } from './rendererTrustPolicy.js'
import { developerLogSink, developerLogStore } from './developerLogs.js'
import { createAppEventForwarder } from './eventForwarder.js'
import { RendererEventSubscriptions, registerRendererEventSubscriptionHandler } from './rendererEventSubscriptions.js'
import { resolveElectronSidecarPath } from './sidecarPath.js'
import { configureElectronUserDataPath } from './runtimePaths.js'
import {
  registerPluginProtocolHandler,
  resolveHostRuntimeRoot,
} from './pluginProtocol.js'
import { asChildProcessLike, createSidecarLaunchConfig, resolveSidecarPort, startSidecarReadiness } from './sidecar.js'
import type { OpenDialogOptions } from 'electron'
import type { ElectronInvokeDeps } from './backendBridge.js'
import type { BootBackendInvokeContext, BootLifecycleAdapter } from './bootLifecycle.js'
import type {
  TaskBrowserSurfaceStateEvent,
  TaskBrowserSurfaceVisualFeedbackActionEvent,
} from './taskBrowserSurfaceManager.js'
import type { ElectronFailureReporter } from './failureReporting.js'
import type { SidecarEventEnvelopeLike, SidecarLaunchConfig, SidecarReadinessHandle } from './sidecar.js'
import type { TaskBrowserSessionPurgeIntent } from './taskBrowserSessionPurgeCoordinator.js'

export interface ElectronBootAdapterOptions {
  currentDir: string
  workspaceRoot: string
  env: NodeJS.ProcessEnv
  failureReporter?: ElectronFailureReporter | null
}


type TaskBrowserSurfaceRendererEvent =
  | TaskBrowserSurfaceStateEvent
  | TaskBrowserSurfaceVisualFeedbackActionEvent

export function forwardTaskBrowserSurfaceRendererEvent(
  eventName: 'task-browser-surface-state' | 'task-browser-visual-feedback-action',
  event: TaskBrowserSurfaceRendererEvent,
): void {
  const window = BrowserWindow.fromId(event.windowId)
  if (!window || window.isDestroyed()) return
  window.webContents.send('openforge:event', { eventName, payload: event })
}
function taskBrowserSessionPurgeIntents(value: unknown): TaskBrowserSessionPurgeIntent[] {
  if (!Array.isArray(value)) throw new Error('Rust sidecar returned an invalid Plugin Browser Session purge intent list')
  return value.map(candidate => {
    if (
      typeof candidate !== 'object'
      || candidate === null
      || typeof (candidate as Record<string, unknown>).id !== 'number'
      || !Number.isSafeInteger((candidate as Record<string, unknown>).id)
      || !['task', 'plugin'].includes(String((candidate as Record<string, unknown>).scope))
      || typeof (candidate as Record<string, unknown>).ownerId !== 'string'
      || !(candidate as Record<string, string>).ownerId.trim()
      || typeof (candidate as Record<string, unknown>).createdAt !== 'number'
    ) {
      throw new Error('Rust sidecar returned an invalid Plugin Browser Session purge intent')
    }
    return candidate as TaskBrowserSessionPurgeIntent
  })
}

function shouldDrainTaskBrowserSessionPurges(envelope: SidecarEventEnvelopeLike): boolean {
  if (envelope.eventName === 'plugin-installation-changed') return true
  if (envelope.eventName !== 'task-changed' || typeof envelope.payload !== 'object' || envelope.payload === null) return false
  return (envelope.payload as Record<string, unknown>).action === 'deleted'
}

/** Real Electron Adapter for the Boot Lifecycle Module seam. */
export function createElectronBootAdapter(options: ElectronBootAdapterOptions): BootLifecycleAdapter {
  let sidecarLaunchProcess: SidecarReadinessHandle['process'] | null = null
  const rendererTrustAdapter = new ElectronRendererTrustAdapter()
  const rendererEventSubscriptions = new RendererEventSubscriptions()
  let backendInvokeContext: BootBackendInvokeContext | null = null
  let mainRendererWindow: BrowserWindow | null = null
  const appRenderers = new Set<number>()
  const restartGeometryLeases = new RestartGeometryLeases()
  let restartWorkspace: Promise<RestartWorkspaceIpc> | null = null
  function controlledWorkspace(): Promise<RestartWorkspaceIpc | null> {
    if (app.isPackaged || options.env.OPENFORGE_E2E !== '1' || !options.env.OPENFORGE_ELECTRON_USER_DATA_DIR
      || !options.env.OPENFORGE_SESSION_DAEMON_ROOT || !options.env.OPENFORGE_SESSION_DAEMON_PATH
      || options.env.OPENFORGE_SESSION_DAEMON_SHELL_KEY !== '*') return Promise.resolve(null)
    if (restartWorkspace) return restartWorkspace
    const operationPrefix = '--openforge-restart-operation='
    const operationId = process.argv.find(arg => arg.startsWith(operationPrefix))?.slice(operationPrefix.length) ?? null
    restartWorkspace = createControlledRestartHost({
      root: app.getPath('userData'), operationId,
      inventory: async () => {
        if (!backendInvokeContext) throw new Error('Restart backend is not ready')
        return await handleElectronInvoke({ command: 'get_restart_terminal_inventory', payload: {} }, createInvokeDeps(backendInvokeContext)) as RestartTerminalInventory
      },
      backend: {
        prepare: (operationId, intent) => restartBackendCommand('prepare_app_restart', { operationId, intent }),
        cancel: operationId => restartBackendCommand('cancel_app_restart', { operationId }),
        detach: operationId => restartBackendCommand('detach_app_restart', { operationId }),
        commit: operationId => restartBackendCommand('commit_app_restart', { operationId }),
      },
      replace: async nextOperation => {
        app.relaunch({ args: [...process.argv.slice(1).filter(arg => !arg.startsWith(operationPrefix)), `${operationPrefix}${nextOperation}`] })
        app.quit()
      },
    }).catch(error => { restartWorkspace = null; throw error })
    return restartWorkspace
  }

  async function restartBackendCommand(command: string, payload: { operationId: string; intent?: 'restart' | 'update' }): Promise<void> {
    if (!backendInvokeContext) throw new Error('Restart backend is not ready')
    await forwardToSidecar(command, payload, createInvokeDeps(backendInvokeContext))
  }

  function createInvokeDeps(context: BootBackendInvokeContext): ElectronInvokeDeps {
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
          properties: ['openDirectory'],
          defaultPath,
          buttonLabel,
          message,
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

  const frontendHostRequestRelay = new FrontendHostRequestRelay({
    acknowledgeSidecar: async acknowledgement => {
      if (!backendInvokeContext) return false
      return handleElectronInvoke(
        { command: FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND, payload: acknowledgement },
        createInvokeDeps(backendInvokeContext),
      )
    },
  })
  const taskBrowserPartitionRegistry = new FileTaskBrowserPartitionRegistry(
    () => join(app.getPath('userData'), 'task-browser-partitions.json'),
    { logger: developerLogSink },
  )
  const taskBrowserPermissionPolicy = new TaskBrowserPermissionPolicy({
    store: new FileTaskBrowserPermissionStore(
      () => join(app.getPath('userData'), 'task-browser-permissions.json'),
    ),
    prompt: async request => {
      const window = BrowserWindow.fromId(request.windowId)
      if (!window || window.isDestroyed()) return { decision: 'block', remember: false }
      try {
        const result = await dialog.showMessageBox(window, taskBrowserPermissionPromptOptions(request))
        return {
          decision: result.response === 0 ? 'allow' : 'block',
          remember: result.checkboxChecked === true,
        }
      } catch (error) {
        developerLogSink.error('[task-browser-permission] Failed to present permission prompt; request denied', error)
        return { decision: 'block', remember: false }
      }
    },
  })
  const invokeForTaskBrowserAuthorization = async (command: string, payload: unknown) => {
    if (!backendInvokeContext) throw new Error('Rust sidecar is not available')
    return handleElectronInvoke({ command, payload }, createInvokeDeps(backendInvokeContext))
  }
  const taskBrowserSurfaceManager = new TaskBrowserSurfaceManager({
    factory: new ElectronTaskBrowserSurfaceFactory(),
    registry: taskBrowserPartitionRegistry,
    permissions: taskBrowserPermissionPolicy,
    artifacts: new FileTaskBrowserCaptureArtifactStore(
      () => join(app.getPath('userData'), 'task-artifacts', 'browser-captures'),
    ),
    authorize: createTaskBrowserSurfaceAuthorizer(invokeForTaskBrowserAuthorization),
    authorizePlugin: createPluginBrowserSessionAuthorizer(invokeForTaskBrowserAuthorization),
    rendererZoomFactor: electronRendererZoomFactor,
    onStateChanged: event => {
      forwardTaskBrowserSurfaceRendererEvent('task-browser-surface-state', event)
    },
    onVisualFeedbackAction: event => {
      forwardTaskBrowserSurfaceRendererEvent('task-browser-visual-feedback-action', event)
    },
  })
  const taskBrowserSurfaceIpc = new TaskBrowserSurfaceIpcRouter(taskBrowserSurfaceManager)
  const taskBrowserSessionPurgeCoordinator = new TaskBrowserSessionPurgeCoordinator({
    backend: {
      async listPending() {
        if (!backendInvokeContext) throw new Error('Rust sidecar is not available')
        const value = await handleElectronInvoke(
          { command: LIST_BROWSER_SESSION_PURGE_INTENTS_COMMAND, payload: null },
          createInvokeDeps(backendInvokeContext),
        )
        return taskBrowserSessionPurgeIntents(value)
      },
      async acknowledge(intentId) {
        if (!backendInvokeContext) throw new Error('Rust sidecar is not available')
        await handleElectronInvoke(
          { command: ACKNOWLEDGE_BROWSER_SESSION_PURGE_INTENT_COMMAND, payload: { intentId } },
          createInvokeDeps(backendInvokeContext),
        )
      },
    },
    registry: taskBrowserPartitionRegistry,
    beginPurge: intent => {
      if (intent.scope === 'task') taskBrowserSurfaceManager.destroyTask(intent.ownerId)
      else taskBrowserSurfaceManager.destroyPlugin(intent.ownerId)
    },
    purgeSession: record => taskBrowserSurfaceManager.purgeRegisteredSession(record),
    logger: developerLogSink,
  })

  async function createMainWindow(): Promise<BrowserWindow> {
    const ids = await (await controlledWorkspace())?.launchWindowIds(options.env.OPENFORGE_E2E_RESTART_WINDOWS === '2' ? 2 : 1) ?? [randomUUID()]
    const windows: BrowserWindow[] = []
    for (const id of ids) windows.push(await createWorkspaceWindow(id))
    installRestartMenu(async rendererId => {
      if (!appRenderers.has(rendererId)) throw new Error('Restart requires an OpenForge workspace')
      const host = await controlledWorkspace()
      if (!host) throw new Error('Session-preserving Restart is unavailable in this launch')
      await host.handle(rendererId, 'restart_app', {})
    })
    return windows[0]
  }

  async function createWorkspaceWindow(stableWindowId: string): Promise<BrowserWindow> {
    if (backendInvokeContext?.getSidecarConfig()) {
      await taskBrowserSessionPurgeCoordinator.drain()
    }
    await purgeSupersededTaskBrowserPartitions({
      registry: taskBrowserPartitionRegistry,
      clearSession: record => taskBrowserSurfaceManager.purgeRegisteredSession(record),
      logger: developerLogSink,
    })
    const preloadPath = createPreloadPath(options.currentDir)
    const window = new BrowserWindow(createMainWindowOptions(preloadPath))
    mainRendererWindow = window
    appRenderers.add(window.webContents.id)
    const unregisterRestartWindow = (await controlledWorkspace())?.register(window.webContents.id, stableWindowId, operationId => {
      window.webContents.send('openforge:event', { eventName: 'restart-workspace-capture', payload: { operationId } })
    })
    const updateTaskBrowserWindowBounds = () => {
      const { width, height } = window.getContentBounds()
      taskBrowserSurfaceManager.updateWindowBounds(window.id, { x: 0, y: 0, width, height })
    }
    const { width, height } = window.getContentBounds()
    taskBrowserSurfaceManager.registerWindow(window.id, { x: 0, y: 0, width, height })
    window.on('resize', updateTaskBrowserWindowBounds)
    window.on('closed', () => {
      appRenderers.delete(mainWebContentsId)
      restartGeometryLeases.forget(mainWebContentsId)
      unregisterRestartWindow?.()
      taskBrowserSurfaceManager.unregisterWindow(window.id)
      rendererEventSubscriptions.clear(mainWebContentsId)
      if (mainRendererWindow === window) mainRendererWindow = null
      void frontendHostRequestRelay.rendererLost(mainWebContentsId)
    })

    const rendererUrl = rendererTrustAdapter.trustedRendererUrlFromEnv(options.env)
    const trustedOrigins = rendererTrustAdapter.trustedRendererOrigins(rendererUrl)
    const mainWebContentsId = window.webContents.id
    window.on('focus', () => restartGeometryLeases.focus(mainWebContentsId))
    window.webContents.on('did-frame-navigate', (_event, _url, _status, _statusText, isMainFrame) => {
      if (!isMainFrame) return
      restartGeometryLeases.forget(mainWebContentsId)
      if (window.isFocused()) restartGeometryLeases.focus(mainWebContentsId)
    })
    window.webContents.on('render-process-gone', () => {
      rendererEventSubscriptions.clear(mainWebContentsId)
      void frontendHostRequestRelay.rendererLost(mainWebContentsId)
    })
    window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
      callback(rendererTrustAdapter.shouldGrantRendererPermission({
        permission,
        isMainWindowWebContents: webContents.id === mainWebContentsId,
        requestingUrl: details.requestingUrl,
        trustedOrigins,
        mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
      }))
    })

    developerLogSink.info(`[electron] Loading renderer from ${rendererUrl ?? 'packaged dist/index.html'}`)
    await loadAndRevealMainWindow(window, rendererUrl
      ? { rendererUrl }
      : { filePath: join(options.currentDir, '..', 'dist', 'index.html') }, {
      failureReporter: options.failureReporter,
    })
    return window
  }

  return {
    registerPluginProtocolSchemeAsPrivileged(): void {
      rendererTrustAdapter.registerPluginProtocolSchemeAsPrivileged(protocol)
    },

    registerBackendInvokeHandler(context: BootBackendInvokeContext): void {
      backendInvokeContext = context
      registerRendererEventSubscriptionHandler(
        ipcMain,
        rendererEventSubscriptions,
        () => [...appRenderers],
      )
      ipcMain.handle('openforge:invoke', async (event, request: unknown) => {
        const typedRequest = request as { command?: unknown; payload?: unknown }
        if (typedRequest.command === FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND) {
          return frontendHostRequestRelay.acknowledge(event.sender.id, typedRequest.payload)
        }
        if (typeof typedRequest.command === 'string' && isTaskBrowserSurfaceCommand(typedRequest.command)) {
          const owningWindow = BrowserWindow.fromWebContents(event.sender)
          const windowId = owningWindow && owningWindow.webContents.id === event.sender.id ? owningWindow.id : null
          return taskBrowserSurfaceIpc.handle(typedRequest.command, typedRequest.payload, windowId)
        }
        if (typedRequest.command === 'pty_resize' && typedRequest.payload && typeof typedRequest.payload === 'object' && 'attachment' in typedRequest.payload) {
          if (!await controlledWorkspace() || !appRenderers.has(event.sender.id) || event.senderFrame !== event.sender.mainFrame) {
            throw new Error('Untrusted terminal geometry request')
          }
          const { attachment, ...payload } = typedRequest.payload as Record<string, unknown>
          const fence = payload.fence as RestartTerminalFence | undefined
          if (!attachment || typeof attachment !== 'object' || typeof payload.shellSessionKey !== 'string'
            || !fence?.controller || typeof fence.controller.installation !== 'string' || typeof fence.controller.lifetime !== 'string'
            || !Number.isSafeInteger(fence.controller.generation) || !Number.isSafeInteger(fence.instanceId)) {
            throw new Error('Invalid terminal geometry identity')
          }
          return restartGeometryLeases.resize(event.sender.id, payload.shellSessionKey, fence, attachment as RestartAttachmentIdentity, async () => {
            if (!appRenderers.has(event.sender.id)) throw new Error('Terminal renderer closed before resize')
            await handleElectronInvoke({ command: 'pty_resize', payload }, createInvokeDeps(context))
          })
        }
        return invokeWithTaskBrowserSessionPurgeDrain(
          typedRequest,
          () => handleElectronInvoke(typedRequest, {
            ...createInvokeDeps(context),
            restartWorkspace: async (command, payload) => {
              if (!appRenderers.has(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted restart workspace renderer')
              const host = await controlledWorkspace()
              if (!host && command === 'get_restart_workspace') return null
              if (!host) throw new Error('Controlled restart is disabled')
              return host.handle(event.sender.id, command, payload)
            },
          }),
          () => taskBrowserSessionPurgeCoordinator.drain(),
        )
      })
    },

    configureUserDataPath(): string | null {
      return configureElectronUserDataPath(app, options.env)
    },

    onWindowAllClosed(handler: () => void): void {
      app.on('window-all-closed', handler)
    },

    onBeforeQuit(handler: (event: { preventDefault(): void }) => void): void {
      app.on('before-quit', event => {
        void frontendHostRequestRelay.shutdown()
        taskBrowserSurfaceManager.destroyAll()
        handler(event)
      })
    },

    exit(exitCode?: number): void {
      app.exit(exitCode)
    },

    waitForAppReady(): Promise<void> {
      return app.whenReady()
    },

    resolveSidecarPath(): string | null {
      return resolveElectronSidecarPath(options.env, options.currentDir)
    },

    createSidecarLaunchConfig(sidecarPath: string): SidecarLaunchConfig {
      return createSidecarLaunchConfig({
        executablePath: sidecarPath,
        port: resolveSidecarPort(options.env),
        processEnv: {
          ...options.env,
          OPENFORGE_RESTART_OPERATION: process.argv.find(arg => arg.startsWith('--openforge-restart-operation='))?.split('=')[1],
        },
      })
    },

    async startSidecar(config: SidecarLaunchConfig): Promise<SidecarReadinessHandle> {
      developerLogSink.info(`[electron] Starting Rust sidecar: ${config.command} --host ${config.host} --port ${config.port}`)
      const sidecar = await startSidecarReadiness(config, {
        spawn: (command, args, spawnOptions) => asChildProcessLike(spawn(command, [...args], spawnOptions)),
        fetch: (url, init) => fetch(url, init),
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
        onSpawned: (child) => {
          sidecarLaunchProcess = child
        },
        logSidecarOutput: true,
        logger: developerLogSink,
        failureReporter: options.failureReporter,
        createEventStream: sidecarConfig => {
          let eventListener: ((envelope: SidecarEventEnvelopeLike) => void) | null = null
          const forwarder = createAppEventForwarder({
            sidecarConfig,
            fetch: (url, init) => fetch(url, init),
            onEvent: envelope => {
              const renderer = mainRendererWindow
                && !mainRendererWindow.isDestroyed()
                && !mainRendererWindow.webContents.isDestroyed()
                ? {
                    id: mainRendererWindow.webContents.id,
                    send: (channel: string, payload: unknown) =>
                      mainRendererWindow?.webContents.send(channel, payload),
                  }
                : null
              if (frontendHostRequestRelay.forward(envelope, renderer)) return false
              handleTaskBrowserSurfaceLifecycleEvent(taskBrowserSurfaceManager, envelope)
              eventListener?.(envelope)
              if (shouldDrainTaskBrowserSessionPurges(envelope)) {
                void taskBrowserSessionPurgeCoordinator.drain()
              }
            },
            windows: envelope => BrowserWindow.getAllWindows().filter(window => (
              rendererEventSubscriptions.has(window.webContents.id, envelope.eventName)
            )),
            failureReporter: options.failureReporter,
          })
          return {
            ...forwarder,
            onEvent(listener: (envelope: SidecarEventEnvelopeLike) => void): void {
              eventListener = listener
            },
          }
        },
      })
      const readiness = await sidecar.ready()
      developerLogSink.info(`[electron] Rust sidecar is ready at ${readiness.identity.readinessUrl}`)
      sidecarLaunchProcess = sidecar.process
      return sidecar
    },

    getSidecarLaunchProcess(): SidecarReadinessHandle['process'] | null {
      return sidecarLaunchProcess
    },

    registerPluginProtocolHandler(sidecarConfig: SidecarLaunchConfig | null): void {
      registerPluginProtocolHandler(protocol, {
        workspaceRoot: options.workspaceRoot,
        hostRuntimeRoot: resolveHostRuntimeRoot(options.currentDir),
        sidecarConfig,
        fetch: (url, init) => fetch(url, init),
      })
    },

    applyRendererCsp(sidecarConfig: SidecarLaunchConfig | null): void {
      rendererTrustAdapter.applyRendererCsp(session.defaultSession, sidecarConfig)
    },

    createMainWindow,

    quit(): void {
      app.quit()
    },
  }
}
