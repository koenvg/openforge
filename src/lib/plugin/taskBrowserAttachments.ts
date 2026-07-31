import { BrowserSurfaceError } from '@openforge-app/plugin-sdk/frontend'
import type { Disposable } from '@openforge-app/plugin-sdk/frontend'

const MAX_ATTACHMENT_UPDATE_ATTEMPTS = 3

let attachmentSequence = 0

type SerializableBounds = { x: number; y: number; width: number; height: number }

interface TaskBrowserAttachmentReference {
  surfaceId: string
  attachmentId: string
  attachmentGeneration: number
}

interface TaskBrowserAttachmentUpdate extends TaskBrowserAttachmentReference {
  bounds: SerializableBounds | null
}

export interface TaskBrowserAttachmentHost {
  update(payload: TaskBrowserAttachmentUpdate): Promise<unknown>
  validateUpdate(response: unknown): void
  detach(payload: TaskBrowserAttachmentReference): Promise<void>
}

interface CreateTaskBrowserAttachmentRequest {
  pluginId: string
  taskId: string
  surfaceId: string
  host: TaskBrowserAttachmentHost
  element: HTMLElement
}

interface TrackedSurfaceAttachments {
  pluginId: string
  taskId: string
  attachments: Set<Disposable>
}

interface AttachmentCleanupScope {
  pluginId: string
  taskId: string | null
  surfaceId: string | null
}

interface ActiveAttachmentCleanup {
  scope: AttachmentCleanupScope
  operation: Promise<void>
}

function intersectBounds(left: SerializableBounds, right: SerializableBounds): SerializableBounds | null {
  const x = Math.max(left.x, right.x)
  const y = Math.max(left.y, right.y)
  const rightEdge = Math.min(left.x + left.width, right.x + right.width)
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height)
  if (rightEdge <= x || bottomEdge <= y) return null
  return { x, y, width: rightEdge - x, height: bottomEdge - y }
}

function visibleElementBounds(element: HTMLElement, rect: DOMRect): SerializableBounds | null {
  const style = getComputedStyle(element)
  if (!element.isConnected || rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return null

  let visible: SerializableBounds | null = intersectBounds(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
  )

  let ancestor = element.parentElement
  while (visible && ancestor) {
    const ancestorStyle = getComputedStyle(ancestor)
    const clips = (value: string) => value !== '' && value !== 'visible'
    const clipsX = clips(ancestorStyle.overflowX) || clips(ancestorStyle.overflow)
    const clipsY = clips(ancestorStyle.overflowY) || clips(ancestorStyle.overflow)
    if (clipsX || clipsY) {
      const ancestorRect = ancestor.getBoundingClientRect()
      const clip = {
        x: clipsX ? ancestorRect.x : visible.x,
        y: clipsY ? ancestorRect.y : visible.y,
        width: clipsX ? ancestorRect.width : visible.width,
        height: clipsY ? ancestorRect.height : visible.height,
      }
      visible = intersectBounds(visible, clip)
    }
    ancestor = ancestor.parentElement
  }
  return visible
}

class TaskBrowserAttachmentLifecycle {
  private readonly trackedSurfaceAttachments = new Map<string, TrackedSurfaceAttachments>()
  private readonly activeCleanups = new Map<number, ActiveAttachmentCleanup>()
  private cleanupSequence = 0
  private cleanupEpoch = 0

  async create(request: CreateTaskBrowserAttachmentRequest): Promise<Disposable> {
    const { pluginId, taskId, surfaceId, host, element } = request
    await this.waitForStableCleanup({ pluginId, taskId, surfaceId })

    let released = false
    let attachmentPromise: Promise<Disposable> | null = null
    const pendingAttachment: Disposable = {
      async dispose() {
        released = true
        const attachment = await attachmentPromise?.catch(() => null)
        await attachment?.dispose()
      },
    }
    attachmentPromise = this.createDomAttachment(host, surfaceId, element)
    const trackedAttachment = this.track(pluginId, taskId, surfaceId, pendingAttachment)

    try {
      await attachmentPromise
      if (released) {
        throw new BrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Attachment was released during attachment')
      }
      return trackedAttachment
    } catch (error) {
      const releasedByLifecycle = released
      await trackedAttachment.dispose()
      if (releasedByLifecycle && !(error instanceof BrowserSurfaceError && error.code === 'SURFACE_DESTROYED')) {
        throw new BrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Attachment was released during attachment')
      }
      throw error
    }
  }

  cleanupSurface(
    pluginId: string,
    taskId: string,
    surfaceId: string,
    cleanup: () => Promise<void>,
  ): Promise<void> {
    return this.runCleanup({ pluginId, taskId, surfaceId }, async () => {
      await this.disposeSurface(surfaceId)
      await cleanup()
    })
  }

  cleanupTask(pluginId: string, taskId: string, cleanup: () => Promise<void>): Promise<void> {
    return this.runCleanup({ pluginId, taskId, surfaceId: null }, async () => {
      await this.disposeWhere(entry => entry.pluginId === pluginId && entry.taskId === taskId)
      await cleanup()
    })
  }

  cleanupPlugin(pluginId: string, cleanup: () => Promise<void>): Promise<void> {
    return this.runCleanup({ pluginId, taskId: null, surfaceId: null }, async () => {
      await this.disposeWhere(entry => entry.pluginId === pluginId)
      await cleanup()
    })
  }

  waitForTaskCleanup(pluginId: string, taskId: string): Promise<void> {
    return this.waitForStableCleanup({ pluginId, taskId, surfaceId: null })
  }

  private cleanupScopesOverlap(left: AttachmentCleanupScope, right: AttachmentCleanupScope): boolean {
    if (left.pluginId !== right.pluginId) return false
    if (left.taskId !== null && right.taskId !== null && left.taskId !== right.taskId) return false
    return left.surfaceId === null || right.surfaceId === null || left.surfaceId === right.surfaceId
  }

  private async waitForCleanup(scope: AttachmentCleanupScope): Promise<number> {
    let observedEpoch = this.cleanupEpoch
    while (true) {
      const pending = Array.from(this.activeCleanups.values())
        .filter(cleanup => this.cleanupScopesOverlap(cleanup.scope, scope))
        .map(cleanup => cleanup.operation.catch(() => undefined))
      await Promise.all(pending)
      if (observedEpoch === this.cleanupEpoch) {
        const stillActive = Array.from(this.activeCleanups.values())
          .some(cleanup => this.cleanupScopesOverlap(cleanup.scope, scope))
        if (!stillActive) return observedEpoch
      }
      observedEpoch = this.cleanupEpoch
    }
  }

  private async waitForStableCleanup(scope: AttachmentCleanupScope): Promise<void> {
    while (true) {
      const stableEpoch = await this.waitForCleanup(scope)
      if (stableEpoch === this.cleanupEpoch) return
    }
  }

  private runCleanup(scope: AttachmentCleanupScope, cleanup: () => Promise<void>): Promise<void> {
    this.cleanupEpoch += 1
    const cleanupId = ++this.cleanupSequence
    const previous = Array.from(this.activeCleanups.values())
      .filter(active => this.cleanupScopesOverlap(active.scope, scope))
      .map(active => active.operation.catch(() => undefined))
    let operation: Promise<void>
    operation = Promise.all(previous)
      .then(() => cleanup())
      .finally(() => { this.activeCleanups.delete(cleanupId) })
    this.activeCleanups.set(cleanupId, { scope, operation })
    return operation
  }

  private track(
    pluginId: string,
    taskId: string,
    surfaceId: string,
    attachment: Disposable,
  ): Disposable {
    const trackedSurfaceAttachments = this.trackedSurfaceAttachments
    let entry = trackedSurfaceAttachments.get(surfaceId)
    if (!entry) {
      entry = { pluginId, taskId, attachments: new Set() }
      trackedSurfaceAttachments.set(surfaceId, entry)
    }
    let tracked = true
    const disposable: Disposable = {
      async dispose() {
        if (!tracked) return
        tracked = false
        entry?.attachments.delete(disposable)
        if (entry?.attachments.size === 0 && trackedSurfaceAttachments.get(surfaceId) === entry) {
          trackedSurfaceAttachments.delete(surfaceId)
        }
        await attachment.dispose()
      },
    }
    entry.attachments.add(disposable)
    return disposable
  }

  private async disposeSurface(surfaceId: string): Promise<void> {
    const entry = this.trackedSurfaceAttachments.get(surfaceId)
    if (!entry) return
    this.trackedSurfaceAttachments.delete(surfaceId)
    await Promise.allSettled(Array.from(entry.attachments, attachment => attachment.dispose()))
  }

  private async disposeWhere(predicate: (entry: TrackedSurfaceAttachments) => boolean): Promise<void> {
    const surfaceIds = Array.from(this.trackedSurfaceAttachments.entries())
      .filter(([, entry]) => predicate(entry))
      .map(([surfaceId]) => surfaceId)
    await Promise.all(surfaceIds.map(surfaceId => this.disposeSurface(surfaceId)))
  }

  private async createDomAttachment(
    host: TaskBrowserAttachmentHost,
    surfaceId: string,
    element: HTMLElement,
  ): Promise<Disposable> {
    const attachmentGeneration = ++attachmentSequence
    const attachmentId = `task-browser-attachment-${attachmentGeneration}`
    let disposed = false
    let frame: number | null = null
    let intersecting = true
    let shouldTrackPosition = false
    let lastBoundsKey: string | undefined
    let failedBoundsKey: string | undefined
    let failedBoundsAttempts = 0
    let updateQueue: Promise<void> = Promise.resolve()

    const update = async () => {
      if (disposed) return
      const rect = element.getBoundingClientRect()
      const bounds = intersecting ? visibleElementBounds(element, rect) : null
      shouldTrackPosition = bounds !== null
      // These bounds are CSS pixels; the host converts them with the renderer zoom factor, which moves
      // devicePixelRatio with it. A fixed-size attachment keeps its CSS rect across a zoom change, so the
      // ratio belongs in the key that decides whether the host still needs a fresh push.
      const boundsKey = JSON.stringify([bounds, window.devicePixelRatio])
      if (boundsKey === lastBoundsKey) {
        failedBoundsKey = undefined
        failedBoundsAttempts = 0
        return
      }
      if (boundsKey !== failedBoundsKey) {
        failedBoundsKey = undefined
        failedBoundsAttempts = 0
      }
      if (failedBoundsAttempts >= MAX_ATTACHMENT_UPDATE_ATTEMPTS) return

      try {
        const response = await host.update({ surfaceId, attachmentId, attachmentGeneration, bounds })
        host.validateUpdate(response)
        lastBoundsKey = boundsKey
        failedBoundsKey = undefined
        failedBoundsAttempts = 0
      } catch (error) {
        failedBoundsKey = boundsKey
        failedBoundsAttempts += 1
        throw error
      }
    }

    const queueUpdate = (): Promise<void> => {
      const operation = updateQueue.then(update)
      updateQueue = operation.catch(() => undefined)
      return operation
    }

    const reportScheduledError = (error: unknown) => {
      console.error('[taskBrowserSurfaces] Failed to update Task Browser Attachment bounds:', error)
    }

    const schedule = () => {
      if (disposed || frame !== null) return
      if (typeof requestAnimationFrame === 'function') {
        frame = requestAnimationFrame(() => {
          void queueUpdate()
            .catch(reportScheduledError)
            .finally(() => {
              frame = null
              if (
                shouldTrackPosition
                || (failedBoundsKey !== undefined && failedBoundsAttempts < MAX_ATTACHMENT_UPDATE_ATTEMPTS)
              ) schedule()
            })
        })
      } else {
        void queueUpdate().catch(reportScheduledError)
      }
    }

    while (true) {
      try {
        await queueUpdate()
        break
      } catch (error) {
        if (failedBoundsAttempts >= MAX_ATTACHMENT_UPDATE_ATTEMPTS) throw error
      }
    }

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    const intersectionObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => {
          const entry = entries.find(candidate => candidate.target === element)
          intersecting = entry?.isIntersecting ?? false
          schedule()
        })
      : null
    const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
    resizeObserver?.observe(element)
    intersectionObserver?.observe(element)
    mutationObserver?.observe(document.documentElement, { attributes: true, childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    if (shouldTrackPosition) schedule()

    return {
      async dispose() {
        if (disposed) return
        disposed = true
        if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        resizeObserver?.disconnect()
        intersectionObserver?.disconnect()
        mutationObserver?.disconnect()
        window.removeEventListener('resize', schedule)
        window.removeEventListener('scroll', schedule, true)
        await updateQueue
        try {
          await host.detach({ surfaceId, attachmentId, attachmentGeneration })
        } catch (error) {
          if (!(error instanceof BrowserSurfaceError) || error.code !== 'SURFACE_DESTROYED') throw error
        }
      },
    }
  }
}

export const taskBrowserAttachments = new TaskBrowserAttachmentLifecycle()
