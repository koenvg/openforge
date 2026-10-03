import { join } from 'node:path'
import { BrowserWindow, app, dialog } from 'electron'
import type { ElectronInvokeRequest } from './backendBridge.js'
import type { ElectronBackendAdapter } from './electronBackendAdapter.js'
import { developerLogSink } from './developerLogs.js'
import {
  ACKNOWLEDGE_BROWSER_SESSION_PURGE_INTENT_COMMAND,
  LIST_BROWSER_SESSION_PURGE_INTENTS_COMMAND,
} from './internalSidecarCommandRegistrations.js'
import { FileTaskBrowserCaptureArtifactStore } from './taskBrowserCaptureArtifactStore.js'
import { FileTaskBrowserPartitionRegistry } from './taskBrowserPartitionRegistry.js'
import { TaskBrowserPermissionPolicy } from './taskBrowserPermissionPolicy.js'
import { taskBrowserPermissionPromptOptions } from './taskBrowserPermissionPrompt.js'
import { FileTaskBrowserPermissionStore } from './taskBrowserPermissionStore.js'
import {
  TaskBrowserSessionPurgeCoordinator, invokeWithTaskBrowserSessionPurgeDrain,
} from './taskBrowserSessionPurgeCoordinator.js'
import type { TaskBrowserSessionPurgeIntent } from './taskBrowserSessionPurgeCoordinator.js'
import { purgeSupersededTaskBrowserPartitions } from './supersededTaskBrowserPartitionCleanup.js'
import { createPluginBrowserSessionAuthorizer, createTaskBrowserSurfaceAuthorizer } from './taskBrowserSurfaceAuthorization.js'
import { ElectronTaskBrowserSurfaceFactory, electronRendererZoomFactor } from './taskBrowserSurfaceElectronAdapter.js'
import { TaskBrowserSurfaceIpcRouter } from './taskBrowserSurfaceIpc.js'
import { TaskBrowserSurfaceManager } from './taskBrowserSurfaceManager.js'
import type { TaskBrowserSurfaceStateEvent, TaskBrowserSurfaceVisualFeedbackActionEvent } from './taskBrowserSurfaceManager.js'
import { handleTaskBrowserSurfaceLifecycleEvent } from './taskBrowserSurfaceLifecycle.js'
import type { SidecarEventEnvelopeLike } from './sidecar.js'

type TaskBrowserSurfaceRendererEvent = TaskBrowserSurfaceStateEvent | TaskBrowserSurfaceVisualFeedbackActionEvent

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

/** Owns browser partitions, permissions, captures and surfaces until native window teardown or approved Quit. */
export class ElectronTaskBrowserAdapter {
  private readonly registry: FileTaskBrowserPartitionRegistry
  private readonly manager: TaskBrowserSurfaceManager
  private readonly ipc: TaskBrowserSurfaceIpcRouter
  private readonly purges: TaskBrowserSessionPurgeCoordinator

  constructor(private readonly backend: ElectronBackendAdapter) {
    this.registry = new FileTaskBrowserPartitionRegistry(
      () => join(app.getPath('userData'), 'task-browser-partitions.json'), { logger: developerLogSink },
    )
    const permissions = new TaskBrowserPermissionPolicy({
      store: new FileTaskBrowserPermissionStore(() => join(app.getPath('userData'), 'task-browser-permissions.json')),
      prompt: async request => {
        const window = BrowserWindow.fromId(request.windowId)
        if (!window || window.isDestroyed()) return { decision: 'block', remember: false }
        try {
          const result = await dialog.showMessageBox(window, taskBrowserPermissionPromptOptions(request))
          return { decision: result.response === 0 ? 'allow' : 'block', remember: result.checkboxChecked === true }
        } catch (error) {
          developerLogSink.error('[task-browser-permission] Failed to present permission prompt; request denied', error)
          return { decision: 'block', remember: false }
        }
      },
    })
    const authorize = async (command: string, payload: unknown) => backend.invoke({ command, payload })
    this.manager = new TaskBrowserSurfaceManager({
      factory: new ElectronTaskBrowserSurfaceFactory(), registry: this.registry, permissions,
      artifacts: new FileTaskBrowserCaptureArtifactStore(() => join(app.getPath('userData'), 'task-artifacts', 'browser-captures')),
      authorize: createTaskBrowserSurfaceAuthorizer(authorize),
      authorizePlugin: createPluginBrowserSessionAuthorizer(authorize),
      rendererZoomFactor: electronRendererZoomFactor,
      onStateChanged: event => forwardTaskBrowserSurfaceRendererEvent('task-browser-surface-state', event),
      onVisualFeedbackAction: event => forwardTaskBrowserSurfaceRendererEvent('task-browser-visual-feedback-action', event),
    })
    this.ipc = new TaskBrowserSurfaceIpcRouter(this.manager)
    this.purges = new TaskBrowserSessionPurgeCoordinator({
      backend: {
        listPending: async () => taskBrowserSessionPurgeIntents(await backend.invoke({ command: LIST_BROWSER_SESSION_PURGE_INTENTS_COMMAND, payload: null })),
        acknowledge: async intentId => {
          await backend.invoke({ command: ACKNOWLEDGE_BROWSER_SESSION_PURGE_INTENT_COMMAND, payload: { intentId } })
        },
      },
      registry: this.registry,
      beginPurge: intent => {
        if (intent.scope === 'task') this.manager.destroyTask(intent.ownerId)
        else this.manager.destroyPlugin(intent.ownerId)
      },
      purgeSession: record => this.manager.purgeRegisteredSession(record), logger: developerLogSink,
    })
  }

  async prepareWindow(): Promise<void> {
    if (this.backend.hasSidecar) await this.purges.drain()
    await purgeSupersededTaskBrowserPartitions({
      registry: this.registry,
      clearSession: record => this.manager.purgeRegisteredSession(record), logger: developerLogSink,
    })
  }

  registerWindow(window: BrowserWindow): () => void {
    const bounds = () => {
      const { width, height } = window.getContentBounds()
      return { x: 0, y: 0, width, height }
    }
    this.manager.registerWindow(window.id, bounds())
    window.on('resize', () => this.manager.updateWindowBounds(window.id, bounds()))
    return () => this.manager.unregisterWindow(window.id)
  }

  handle(command: string, payload: unknown, windowId: number | null): Promise<unknown> {
    return this.ipc.handle(command, payload, windowId)
  }

  invokeWithPurgeDrain(request: ElectronInvokeRequest, invoke: () => Promise<unknown>): Promise<unknown> {
    return invokeWithTaskBrowserSessionPurgeDrain(request, invoke, () => this.purges.drain())
  }

  onEvent(envelope: SidecarEventEnvelopeLike): void {
    handleTaskBrowserSurfaceLifecycleEvent(this.manager, envelope)
  }

  drainAfterEvent(envelope: SidecarEventEnvelopeLike): void {
    if (shouldDrainTaskBrowserSessionPurges(envelope)) void this.purges.drain()
  }

  shutdown(): void { this.manager.destroyAll() }
}
