import type {
  BrowserSurfaceCapture,
  BrowserSurfaceRegion,
  TaskBrowserSurfaceController,
} from '@openforge-app/plugin-sdk/frontend'

interface CaptureAnnotation {
  number: number
  rect: BrowserSurfaceRegion
  comment: string
  capture: BrowserSurfaceCapture
}

interface VisualFeedbackEditorOptions {
  onError(error: string | null): void
}

export interface VisualFeedbackEditorState {
  readonly active: boolean
  readonly busy: boolean
  readonly annotations: readonly CaptureAnnotation[]
  setSurface(surface: TaskBrowserSurfaceController | null): Promise<void>
  toggle(): Promise<void>
  discard(): Promise<void>
  destroy(): Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createVisualFeedbackEditor({ onError }: VisualFeedbackEditorOptions): VisualFeedbackEditorState {
  let active = $state(false)
  let busy = $state(false)
  let annotations = $state<CaptureAnnotation[]>([])
  let nextAnnotationNumber = 1

  let surface: TaskBrowserSurfaceController | null = null
  let generation = 0
  let destroyed = false

  function isCurrent(targetSurface: TaskBrowserSurfaceController, targetGeneration: number): boolean {
    return !destroyed && surface === targetSurface && generation === targetGeneration
  }

  function resetState(): void {
    active = false
    busy = false
    annotations = []
    nextAnnotationNumber = 1
  }

  async function releaseSurfaceResources(
    targetSurface: TaskBrowserSurfaceController,
    captures: readonly BrowserSurfaceCapture[],
  ): Promise<void> {
    await Promise.allSettled([
      targetSurface.cancelVisibleRegionSelection(),
      ...captures.map(capture => targetSurface.discardCapture(capture.artifactId)),
    ])
  }

  async function setSurface(nextSurface: TaskBrowserSurfaceController | null): Promise<void> {
    if (surface === nextSurface) return

    generation += 1
    const previousSurface = surface
    const previousCaptures = annotations.map(annotation => annotation.capture)
    surface = nextSurface
    resetState()

    if (previousSurface !== null) {
      await releaseSurfaceResources(previousSurface, previousCaptures)
    }
  }

  async function runSelectionLoop(
    targetSurface: TaskBrowserSurfaceController,
    targetGeneration: number,
  ): Promise<void> {
    while (active && isCurrent(targetSurface, targetGeneration)) {
      let createdCapture: BrowserSurfaceCapture | null = null
      try {
        const selection = await targetSurface.selectVisibleRegion()
        if (selection === null || !active || !isCurrent(targetSurface, targetGeneration)) break

        createdCapture = await targetSurface.captureVisibleViewport()
        if (!active || !isCurrent(targetSurface, targetGeneration)) {
          await targetSurface.discardCapture(createdCapture.artifactId).catch(() => undefined)
          break
        }

        annotations = [...annotations, {
          number: nextAnnotationNumber,
          rect: selection.region,
          comment: selection.comment,
          capture: createdCapture,
        }]
        nextAnnotationNumber += 1
      } catch (error) {
        if (createdCapture !== null) {
          await targetSurface.discardCapture(createdCapture.artifactId).catch(() => undefined)
        }
        if (isCurrent(targetSurface, targetGeneration)) onError(errorMessage(error))
        break
      }
    }

    if (isCurrent(targetSurface, targetGeneration)) {
      active = false
      busy = false
    }
  }

  async function toggle(): Promise<void> {
    const targetSurface = surface
    if (targetSurface === null) return

    if (active) {
      active = false
      await targetSurface.cancelVisibleRegionSelection().catch(() => undefined)
      busy = false
      return
    }

    active = true
    busy = true
    onError(null)
    await runSelectionLoop(targetSurface, generation)
  }

  async function discard(): Promise<void> {
    const targetSurface = surface
    const currentAnnotations = annotations
    if (targetSurface === null || currentAnnotations.length === 0 || busy) return

    const targetGeneration = generation
    busy = true
    onError(null)
    try {
      await Promise.all(currentAnnotations.map(annotation =>
        targetSurface.discardCapture(annotation.capture.artifactId)))
      if (isCurrent(targetSurface, targetGeneration) && annotations === currentAnnotations) {
        annotations = []
        nextAnnotationNumber = 1
      }
    } catch (error) {
      if (isCurrent(targetSurface, targetGeneration)) onError(errorMessage(error))
    } finally {
      if (isCurrent(targetSurface, targetGeneration)) busy = false
    }
  }

  async function destroy(): Promise<void> {
    if (destroyed) return

    destroyed = true
    generation += 1
    const previousSurface = surface
    const previousCaptures = annotations.map(annotation => annotation.capture)
    surface = null
    resetState()

    if (previousSurface !== null) {
      await releaseSurfaceResources(previousSurface, previousCaptures)
    }
  }

  return {
    get active() { return active },
    get busy() { return busy },
    get annotations() { return annotations },
    setSurface,
    toggle,
    discard,
    destroy,
  }
}
