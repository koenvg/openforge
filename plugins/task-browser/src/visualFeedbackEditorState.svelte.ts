import type {
  BrowserSurfaceCapture,
  BrowserSurfaceRegion,
  TaskBrowserSurfaceController,
} from '@openforge-app/plugin-sdk/frontend'

export interface CaptureAnnotation {
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
  setErrorHandler(handler: (error: string | null) => void): void
  setSurface(surface: TaskBrowserSurfaceController | null): Promise<void>
  toggle(): Promise<void>
  discard(): Promise<void>
  send(deliver: (annotations: readonly CaptureAnnotation[]) => Promise<void>): Promise<void>
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
  let errorHandler = onError
  let lastError: string | null = null

  function reportError(error: string | null): void {
    lastError = error
    errorHandler(error)
  }

  function setErrorHandler(handler: (error: string | null) => void): void {
    errorHandler = handler
    handler(lastError)
  }
  let surface: TaskBrowserSurfaceController | null = null
  let generation = 0
  let pendingSend: Promise<void> | null = null
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
    active = false
    surface = nextSurface

    if (previousSurface !== null) {
      await previousSurface.cancelVisibleRegionSelection().catch(() => undefined)
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
        if (isCurrent(targetSurface, targetGeneration)) reportError(errorMessage(error))
        break
      }
    }

    if (isCurrent(targetSurface, targetGeneration)) active = false
  }

  async function toggle(): Promise<void> {
    const targetSurface = surface
    if (targetSurface === null || busy) return

    if (active) {
      active = false
      await targetSurface.cancelVisibleRegionSelection().catch(() => undefined)
      return
    }

    active = true
    reportError(null)
    await runSelectionLoop(targetSurface, generation)
  }

  async function discard(): Promise<void> {
    const targetSurface = surface
    const currentAnnotations = annotations
    if (targetSurface === null || currentAnnotations.length === 0 || busy) return

    const targetGeneration = generation
    busy = true
    active = false
    reportError(null)
    await targetSurface.cancelVisibleRegionSelection().catch(() => undefined)
    try {
      await Promise.all(currentAnnotations.map(annotation =>
        targetSurface.discardCapture(annotation.capture.artifactId)))
      if (isCurrent(targetSurface, targetGeneration) && annotations === currentAnnotations) {
        annotations = []
        nextAnnotationNumber = 1
      }
    } catch (error) {
      if (isCurrent(targetSurface, targetGeneration)) reportError(errorMessage(error))
    } finally {
      if (isCurrent(targetSurface, targetGeneration)) busy = false
    }
  }

  async function send(deliver: (annotations: readonly CaptureAnnotation[]) => Promise<void>): Promise<void> {
    const targetSurface = surface
    const currentAnnotations = annotations
    if (targetSurface === null || currentAnnotations.length === 0 || busy) return

    busy = true
    active = false
    reportError(null)
    const operation = (async () => {
      try {
        await targetSurface.cancelVisibleRegionSelection().catch(() => undefined)
        await deliver(currentAnnotations)
        if (annotations === currentAnnotations) {
          annotations = []
          nextAnnotationNumber = 1
        }
      } catch (error) {
        reportError(errorMessage(error))
      } finally {
        busy = false
      }
    })()
    pendingSend = operation
    try {
      await operation
    } finally {
      if (pendingSend === operation) pendingSend = null
    }
  }

  async function destroy(): Promise<void> {
    if (destroyed) return

    const inFlightSend = pendingSend
    if (inFlightSend !== null) await inFlightSend

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
    setErrorHandler,
    setSurface,
    toggle,
    discard,
    send,
    destroy,
  }
}
