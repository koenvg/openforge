import type { WebContents } from 'electron'
import { TaskBrowserSurfaceError } from './taskBrowserSurfaceManager.js'
import type { TaskBrowserSurfaceVisualFeedback } from './taskBrowserSurfaceManager.js'
import {
  buildTaskBrowserVisualFeedbackAnnotationsScript,
  buildTaskBrowserVisualFeedbackDismissScript,
  runTaskBrowserVisualFeedbackOverlay,
} from './taskBrowserVisualFeedbackOverlay.js'
import type { TaskBrowserVisualFeedbackAnnotation } from './taskBrowserVisualFeedbackOverlay.js'

type StoredVisualFeedback = TaskBrowserVisualFeedbackAnnotation & {
  region: TaskBrowserSurfaceVisualFeedback['region']
}

export class TaskBrowserVisualFeedbackController {
  private readonly feedbackAnnotationsByUrl = new Map<string, StoredVisualFeedback[]>()
  private cancelSelection: (() => void) | null = null

  constructor(
    private readonly contents: WebContents,
    private readonly isDestroyed: () => boolean,
    private readonly isAttached: () => boolean,
  ) {}

  async selectVisibleRegion() {
    await this.cancelVisibleRegionSelection()
    if (this.isDestroyed()) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed')
    }
    if (!this.isAttached()) {
      throw new TaskBrowserSurfaceError('CAPTURE_UNAVAILABLE', 'Task Browser Surface must be visible before selecting feedback')
    }
    let requestCancel: (() => void) | null = null
    try {
      const pageUrl = this.contents.getURL()
      const savedAnnotations = this.feedbackAnnotationsByUrl.get(pageUrl) ?? []
      const nextAnnotationNumber = Array.from(this.feedbackAnnotationsByUrl.values())
        .flat()
        .reduce((maximum, annotation) => Math.max(maximum, annotation.number), 0) + 1
      const cancelled = new Promise<null>(resolve => {
        requestCancel = () => resolve(null)
      })
      this.cancelSelection = requestCancel
      const selection = runTaskBrowserVisualFeedbackOverlay(
        (script, userGesture) => this.contents.executeJavaScript(script, userGesture),
        { savedAnnotations, nextAnnotationNumber },
      )
      const result = await Promise.race([selection, cancelled])
      if (result === null) return null
      const pageAnnotations = this.feedbackAnnotationsByUrl.get(pageUrl) ?? []
      pageAnnotations.push({
        ...result.annotation,
        region: { ...result.region },
      })
      this.feedbackAnnotationsByUrl.set(pageUrl, pageAnnotations)
      return {
        region: result.region,
        comment: result.comment,
        annotationNumber: result.annotation.number,
      }
    } catch (error) {
      if (error instanceof TaskBrowserSurfaceError) throw error
      throw new TaskBrowserSurfaceError(
        'CAPTURE_FAILED',
        `Could not select a region on the live Task Browser page: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      if (requestCancel !== null && this.cancelSelection === requestCancel) this.cancelSelection = null
    }
  }

  async cancelVisibleRegionSelection(): Promise<void> {
    const cancel = this.cancelSelection
    cancel?.()
    this.cancelSelection = null
    if (this.isDestroyed() || this.contents.isDestroyed()) return
    await this.contents
      .executeJavaScript(buildTaskBrowserVisualFeedbackDismissScript(), true)
      .catch(() => undefined)
  }

  async clearVisualFeedback(): Promise<void> {
    await this.cancelVisibleRegionSelection()
    this.feedbackAnnotationsByUrl.clear()
    if (this.isDestroyed() || this.contents.isDestroyed()) return
    await this.contents.executeJavaScript(`(() => {
      document.getElementById('__openforge_visual_feedback_annotations__')?.remove();
    })()`, true).catch(() => undefined)
  }

  async replaceVisualFeedback(feedback: readonly TaskBrowserSurfaceVisualFeedback[]): Promise<void> {
    await this.cancelVisibleRegionSelection()
    if (this.isDestroyed() || this.contents.isDestroyed()) {
      throw new TaskBrowserSurfaceError('SURFACE_DESTROYED', 'Task Browser Surface has been destroyed')
    }

    const current = await this.contents.executeJavaScript(`({
      url: location.href,
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    })`, true) as { url: string; width: number; height: number; scrollX: number; scrollY: number }
    const existing = new Map(Array.from(this.feedbackAnnotationsByUrl.values())
      .flat()
      .map(annotation => [annotation.number, annotation]))
    const replacement = new Map<string, StoredVisualFeedback[]>()

    for (const marker of feedback) {
      const previous = existing.get(marker.annotationNumber)
      const viewportWidth = previous === undefined ? current.width : previous.width / previous.region.width
      const viewportHeight = previous === undefined ? current.height : previous.height / previous.region.height
      const scrollX = previous === undefined ? (marker.url === current.url ? current.scrollX : 0) : previous.x - previous.region.x * viewportWidth
      const scrollY = previous === undefined ? (marker.url === current.url ? current.scrollY : 0) : previous.y - previous.region.y * viewportHeight
      const annotations = replacement.get(marker.url) ?? []
      annotations.push({
        number: marker.annotationNumber,
        comment: marker.comment,
        region: { ...marker.region },
        x: scrollX + marker.region.x * viewportWidth,
        y: scrollY + marker.region.y * viewportHeight,
        width: marker.region.width * viewportWidth,
        height: marker.region.height * viewportHeight,
      })
      replacement.set(marker.url, annotations)
    }

    this.feedbackAnnotationsByUrl.clear()
    for (const [url, annotations] of replacement) this.feedbackAnnotationsByUrl.set(url, annotations)
    await this.refreshForCurrentUrl()
  }

  async setVisibility(visibility: '' | 'hidden'): Promise<void> {
    if (this.isDestroyed() || this.contents.isDestroyed()) return
    await this.contents.executeJavaScript(`(() => {
      const annotations = document.getElementById('__openforge_visual_feedback_annotations__');
      if (annotations) annotations.style.visibility = ${JSON.stringify(visibility)};
      if (${visibility === 'hidden'}) return new Promise(resolve => requestAnimationFrame(() => resolve()));
    })()`, true).catch(() => undefined)
  }

  hideForNavigation(): void {
    this.cancelSelection?.()
    this.cancelSelection = null
    if (this.isDestroyed() || this.contents.isDestroyed()) return
    void this.contents.executeJavaScript(`${buildTaskBrowserVisualFeedbackDismissScript()};
    (() => {
      document.getElementById('__openforge_visual_feedback_annotations__')?.remove();
    })()`, true).catch(() => undefined)
  }

  async refreshForCurrentUrl(): Promise<void> {
    if (this.isDestroyed() || this.contents.isDestroyed()) return
    const pageUrl = this.contents.getURL()
    const savedAnnotations = this.feedbackAnnotationsByUrl.get(pageUrl) ?? []
    await this.contents.executeJavaScript(`(() => {
      ${buildTaskBrowserVisualFeedbackAnnotationsScript({
        savedAnnotations,
        expectedUrl: pageUrl,
      })}
    })()`, true)
  }
}
