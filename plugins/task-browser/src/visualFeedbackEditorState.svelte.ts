import type {
  BrowserSurfaceCapture,
  BrowserSurfaceRegion,
  TaskBrowserSurfaceController,
} from '@openforge-app/plugin-sdk/frontend'

export interface VisualFeedbackCapture {
  number: number
  evidence: BrowserSurfaceCapture
}

export interface CaptureAnnotation {
  number: number
  captureNumber: number
  rect: BrowserSurfaceRegion
  comment: string
}

interface VisualFeedbackEditorOptions {
  onError(error: string | null): void
}

export interface VisualFeedbackEditorState {
  readonly active: boolean
  readonly busy: boolean
  readonly captures: readonly VisualFeedbackCapture[]
  readonly annotations: readonly CaptureAnnotation[]
  setErrorHandler(handler: (error: string | null) => void): void
  setSurface(surface: TaskBrowserSurfaceController | null): Promise<void>
  toggle(): Promise<void>
  discard(): Promise<void>
  send(deliver: (
    captures: readonly VisualFeedbackCapture[],
    annotations: readonly CaptureAnnotation[],
  ) => Promise<void>): Promise<void>
  destroy(): Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sameViewport(left: BrowserSurfaceCapture, right: BrowserSurfaceCapture): boolean {
  return left.dataUrl === right.dataUrl
    && left.url === right.url
    && left.title === right.title
    && left.width === right.width
    && left.height === right.height
}

export function createVisualFeedbackEditor({ onError }: VisualFeedbackEditorOptions): VisualFeedbackEditorState {
  let active = $state(false)
  let busy = $state(false)
  let captures = $state<VisualFeedbackCapture[]>([])
  let annotations = $state<CaptureAnnotation[]>([])
  let nextCaptureNumber = 1
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
    captures = []
    annotations = []
    nextCaptureNumber = 1
    nextAnnotationNumber = 1
  }

  async function releaseSurfaceResources(
    targetSurface: TaskBrowserSurfaceController,
    currentCaptures: readonly VisualFeedbackCapture[],
  ): Promise<void> {
    await Promise.allSettled([
      targetSurface.cancelVisibleRegionSelection(),
      targetSurface.clearVisualFeedback(),
      ...currentCaptures.map(capture => targetSurface.discardCapture(capture.evidence.artifactId)),
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

  async function resolveCapture(
    targetSurface: TaskBrowserSurfaceController,
    createdCapture: BrowserSurfaceCapture,
  ): Promise<VisualFeedbackCapture> {
    const existing = captures.find(capture => sameViewport(capture.evidence, createdCapture))
    if (existing !== undefined) {
      await targetSurface.discardCapture(createdCapture.artifactId)
      return existing
    }

    return {
      number: nextCaptureNumber,
      evidence: createdCapture,
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

        const reviewCapture = await resolveCapture(targetSurface, createdCapture)
        if (!active || !isCurrent(targetSurface, targetGeneration)) {
          if (reviewCapture.evidence === createdCapture) {
            await targetSurface.discardCapture(createdCapture.artifactId).catch(() => undefined)
          }
          break
        }

        if (reviewCapture.evidence === createdCapture) {
          captures = [...captures, reviewCapture]
          nextCaptureNumber += 1
        }
        const annotationNumber = selection.annotationNumber ?? nextAnnotationNumber
        annotations = [...annotations, {
          number: annotationNumber,
          captureNumber: reviewCapture.number,
          rect: selection.region,
          comment: selection.comment,
        }]
        nextAnnotationNumber = Math.max(nextAnnotationNumber, annotationNumber + 1)
      } catch (error) {
        if (createdCapture !== null && !captures.some(capture => capture.evidence === createdCapture)) {
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
    const currentCaptures = captures
    if (targetSurface === null || currentCaptures.length === 0 || busy) return

    const targetGeneration = generation
    busy = true
    active = false
    reportError(null)
    await targetSurface.cancelVisibleRegionSelection().catch(() => undefined)
    try {
      await Promise.all(currentCaptures.map(capture =>
        targetSurface.discardCapture(capture.evidence.artifactId)))
      await targetSurface.clearVisualFeedback()
      if (isCurrent(targetSurface, targetGeneration) && captures === currentCaptures) resetState()
    } catch (error) {
      if (isCurrent(targetSurface, targetGeneration)) reportError(errorMessage(error))
    } finally {
      if (isCurrent(targetSurface, targetGeneration)) busy = false
    }
  }

  async function send(deliver: (
    captures: readonly VisualFeedbackCapture[],
    annotations: readonly CaptureAnnotation[],
  ) => Promise<void>): Promise<void> {
    const targetSurface = surface
    const currentCaptures = captures
    const currentAnnotations = annotations
    if (targetSurface === null || currentAnnotations.length === 0 || busy) return

    busy = true
    active = false
    reportError(null)
    const operation = (async () => {
      try {
        await targetSurface.cancelVisibleRegionSelection().catch(() => undefined)
        await deliver(currentCaptures, currentAnnotations)
        await targetSurface.clearVisualFeedback().catch(error => reportError(errorMessage(error)))
        if (captures === currentCaptures && annotations === currentAnnotations) resetState()
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
    const previousCaptures = captures
    surface = null
    resetState()

    if (previousSurface !== null) await releaseSurfaceResources(previousSurface, previousCaptures)
  }

  return {
    get active() { return active },
    get busy() { return busy },
    get captures() { return captures },
    get annotations() { return annotations },
    setErrorHandler,
    setSurface,
    toggle,
    discard,
    send,
    destroy,
  }
}
