import type {
  BrowserSurfaceCapture,
  BrowserSurfaceVisualFeedbackAppearance,
  BrowserSurfaceRegion,
  TaskBrowserSurfaceController,
} from '@openforge-app/plugin-sdk/frontend'
import { createVisualFeedbackArtifacts } from './visualFeedbackArtifacts'
import {
  createVisualFeedbackDraftStore,
  InvalidVisualFeedbackDraftError,
} from './visualFeedbackDraftStore'
import { synchronizeVisualFeedbackMarkers } from './visualFeedbackLiveMarkers'
import type {
  CaptureAnnotation,
  VisualFeedbackCapture,
  VisualFeedbackDraftData,
  VisualFeedbackDraftPersistence,
} from './visualFeedbackEditorTypes'

export type {
  CaptureAnnotation,
  PersistedVisualFeedbackDraft,
  VisualFeedbackCapture,
  VisualFeedbackDraftPersistence,
} from './visualFeedbackEditorTypes'

interface VisualFeedbackEditorOptions {
  onError(error: string | null): void
  persistence?: VisualFeedbackDraftPersistence
}

export interface VisualFeedbackEditorState {
  readonly active: boolean
  readonly busy: boolean
  readonly canUndo: boolean
  readonly saveError: string | null
  readonly captures: readonly VisualFeedbackCapture[]
  readonly annotations: readonly CaptureAnnotation[]
  setErrorHandler(handler: (error: string | null) => void): void
  setAppearance(appearance: BrowserSurfaceVisualFeedbackAppearance): Promise<void>
  setSurface(surface: TaskBrowserSurfaceController | null): Promise<void>
  toggle(): Promise<void>
  updateAnnotation(annotationNumber: number, comment: string, rect: BrowserSurfaceRegion): Promise<void>
  removeAnnotation(annotationNumber: number): Promise<void>
  removeCapture(captureNumber: number): Promise<void>
  undo(): Promise<void>
  retrySave(): Promise<void>
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

interface EditorSnapshot {
  captures: VisualFeedbackCapture[]
  annotations: CaptureAnnotation[]
}

export function createVisualFeedbackEditor({ onError, persistence }: VisualFeedbackEditorOptions): VisualFeedbackEditorState {
  let active = $state(false)
  let busy = $state(false)
  let captures = $state<VisualFeedbackCapture[]>([])
  let annotations = $state<CaptureAnnotation[]>([])
  let nextCaptureNumber = 1
  let nextAnnotationNumber = 1
  let undoSnapshot = $state<EditorSnapshot | null>(null)
  const artifacts = createVisualFeedbackArtifacts()
  const draftStore = createVisualFeedbackDraftStore(persistence)
  let saveError = $state<string | null>(null)
  let restoration = Promise.resolve()
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
  let appearance: BrowserSurfaceVisualFeedbackAppearance = 'light'
  let generation = 0
  let pendingSend: Promise<void> | null = null
  let destroyed = false

  function isCurrent(targetSurface: TaskBrowserSurfaceController, targetGeneration: number): boolean {
    return !destroyed && surface === targetSurface && generation === targetGeneration
  }

  function snapshot(): EditorSnapshot {
    return {
      captures: captures.map(capture => ({ ...capture, evidence: { ...capture.evidence } })),
      annotations: annotations.map(annotation => ({ ...annotation, rect: { ...annotation.rect } })),
    }
  }

  function draftData(): VisualFeedbackDraftData {
    return {
      captures,
      annotations,
      pendingArtifactDiscards: [...artifacts.pendingDiscards],
    }
  }

  async function persistDraft(): Promise<boolean> {
    try {
      await draftStore.persist(draftData())
      if (saveError?.startsWith('Could not save visual feedback:')) saveError = null
      return true
    } catch (error) {
      saveError = `Could not save visual feedback: ${errorMessage(error)}`
      reportError(`${saveError}. Your in-memory feedback is still available; retry saving when ready.`)
      return false
    }
  }

  async function restoreDraft(): Promise<void> {
    try {
      const draft = await draftStore.restore()
      if (draft === null) return
      captures = draft.captures
      annotations = draft.annotations
      artifacts.restorePendingDiscards(draft.pendingArtifactDiscards)
      nextCaptureNumber = Math.max(0, ...captures.map(capture => capture.number)) + 1
      nextAnnotationNumber = Math.max(0, ...annotations.map(annotation => annotation.number)) + 1
    } catch (error) {
      saveError = error instanceof InvalidVisualFeedbackDraftError
        ? error.message
        : `Could not restore visual feedback: ${errorMessage(error)}`
      reportError(`${saveError}. The live Browser Surface remains available.`)
    }
  }

  async function validateCaptureArtifacts(): Promise<void> {
    const targetSurface = surface
    if (targetSurface === null || captures.length === 0) return
    const targetGeneration = generation
    const result = await artifacts.validateAvailability(targetSurface, captures)
    if (!isCurrent(targetSurface, targetGeneration)) return
    captures = result.captures
    if (result.firstError !== null) reportError(result.firstError)
  }

  async function syncVisualFeedback(): Promise<boolean> {
    const targetSurface = surface
    if (targetSurface === null) return false
    try {
      await synchronizeVisualFeedbackMarkers(targetSurface, captures, annotations, appearance)
      if (saveError?.startsWith('Could not save live marker changes:')) saveError = null
      return true
    } catch (error) {
      saveError = `Could not save live marker changes: ${errorMessage(error)}`
      reportError(`${saveError}. Retry when the Browser Surface is available.`)
      return false
    }
  }

  async function setAppearance(nextAppearance: BrowserSurfaceVisualFeedbackAppearance): Promise<void> {
    if (appearance === nextAppearance) return
    appearance = nextAppearance
    await syncVisualFeedback()
  }

  async function finalizePendingArtifactDiscards(): Promise<void> {
    const targetSurface = surface
    if (targetSurface === null || !artifacts.hasPendingDiscards) return
    const failure = await artifacts.cleanupPending(targetSurface)
    if (failure !== null) {
      saveError = `Could not remove an unreferenced background capture: ${errorMessage(failure)}`
      reportError(`${saveError}. Cleanup can be retried safely.`)
    } else if (saveError?.startsWith('Could not remove an unreferenced background capture:')) {
      saveError = null
    }
  }

  async function beginMutation(): Promise<void> {
    await finalizePendingArtifactDiscards()
    undoSnapshot = snapshot()
  }


  function restoreMutation(previous: EditorSnapshot, previousUndo: EditorSnapshot | null): void {
    artifacts.reconcileUndo(previous.captures, captures)
    captures = previous.captures
    annotations = previous.annotations
    undoSnapshot = previousUndo
  }
  function resetState(clearPendingDiscards = true): void {
    active = false
    busy = false
    captures = []
    annotations = []
    nextCaptureNumber = 1
    nextAnnotationNumber = 1
    undoSnapshot = null
    if (clearPendingDiscards) artifacts.clearPendingDiscards()
  }

  async function setSurface(nextSurface: TaskBrowserSurfaceController | null): Promise<void> {
    await restoration
    if (surface === nextSurface) return

    generation += 1
    const previousSurface = surface
    active = false
    surface = nextSurface
    if (nextSurface !== null && artifacts.hasPendingDiscards && undoSnapshot === null) {
      await finalizePendingArtifactDiscards()
      await persistDraft()
    }
    if (previousSurface !== null) {
      await previousSurface.cancelVisibleRegionSelection().catch(() => undefined)
    }
    if (nextSurface !== null) {
      if (annotations.length > 0) await validateCaptureArtifacts()
      await syncVisualFeedback()
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
      artifactState: 'available',
      artifactError: null,
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

        await beginMutation()
        if (reviewCapture.evidence === createdCapture) {
          captures = [...captures, reviewCapture]
          nextCaptureNumber += 1
        }
        const requestedAnnotationNumber = selection.annotationNumber
        const annotationNumber = requestedAnnotationNumber !== undefined
          && !annotations.some(annotation => annotation.number === requestedAnnotationNumber)
          ? requestedAnnotationNumber
          : nextAnnotationNumber
        annotations = [...annotations, {
          number: annotationNumber,
          captureNumber: reviewCapture.number,
          rect: selection.region,
          comment: selection.comment,
        }]
        nextAnnotationNumber = Math.max(nextAnnotationNumber, annotationNumber + 1)
        await persistDraft()
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

  async function updateAnnotation(
    annotationNumber: number,
    comment: string,
    rect: BrowserSurfaceRegion,
  ): Promise<void> {
    const normalizedComment = comment.trim()
    if (normalizedComment.length === 0) {
      reportError('Visual feedback comments cannot be empty')
      return
    }
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0
      || rect.x + rect.width > 1 || rect.y + rect.height > 1) {
      reportError('Marker geometry must stay within normalized page bounds')
      return
    }
    const existing = annotations.find(annotation => annotation.number === annotationNumber)
    if (existing === undefined) return
    await beginMutation()
    annotations = annotations.map(annotation => annotation.number === annotationNumber
      ? { ...annotation, comment: normalizedComment, rect: { ...rect } }
      : annotation)
    reportError(null)
    await syncVisualFeedback()
    await persistDraft()
  }

  async function removeAnnotation(annotationNumber: number): Promise<void> {
    const existing = annotations.find(annotation => annotation.number === annotationNumber)
    if (existing === undefined || busy) return
    const previous = snapshot()
    const previousUndo = undoSnapshot
    busy = true
    try {
      await beginMutation()
      annotations = annotations.filter(annotation => annotation.number !== annotationNumber)
      const stillReferenced = annotations.some(annotation => annotation.captureNumber === existing.captureNumber)
      if (!stillReferenced) {
        const removedCapture = captures.find(capture => capture.number === existing.captureNumber)
        if (removedCapture !== undefined) artifacts.scheduleDiscard(removedCapture)
        captures = captures.filter(capture => capture.number !== existing.captureNumber)
      }

      if (!await persistDraft()) {
        restoreMutation(previous, previousUndo)
        return
      }
      if (await syncVisualFeedback()) return

      const synchronizationError = saveError
      restoreMutation(previous, previousUndo)
      const rollbackPersisted = await persistDraft()
      const rollbackSynchronized = await syncVisualFeedback()
      if (rollbackPersisted && rollbackSynchronized && synchronizationError !== null) {
        saveError = synchronizationError
        reportError(`${synchronizationError}. Retry when the Browser Surface is available.`)
      }
    } finally {
      busy = false
    }
  }

  async function removeCapture(captureNumber: number): Promise<void> {
    const removedCapture = captures.find(capture => capture.number === captureNumber)
    if (removedCapture === undefined || busy) return
    await beginMutation()
    captures = captures.filter(capture => capture.number !== captureNumber)
    annotations = annotations.filter(annotation => annotation.captureNumber !== captureNumber)
    artifacts.scheduleDiscard(removedCapture)
    await syncVisualFeedback()
    await persistDraft()
  }

  async function undo(): Promise<void> {
    const previous = undoSnapshot
    if (previous === null || busy) return
    const currentCaptures = captures
    artifacts.reconcileUndo(previous.captures, currentCaptures)
    captures = previous.captures
    annotations = previous.annotations
    undoSnapshot = null
    await validateCaptureArtifacts()
    await syncVisualFeedback()
    await finalizePendingArtifactDiscards()
    await persistDraft()
  }

  async function retrySave(): Promise<void> {
    await restoration
    saveError = null
    reportError(null)
    await validateCaptureArtifacts()
    await syncVisualFeedback()
    await finalizePendingArtifactDiscards()
    await persistDraft()
  }

  async function discard(): Promise<void> {
    const targetSurface = surface
    const currentCaptures = captures
    const allCaptures = artifacts.allArtifacts(currentCaptures)
    if (targetSurface === null || allCaptures.length === 0 || busy) return

    const targetGeneration = generation
    busy = true
    active = false
    reportError(null)
    await targetSurface.cancelVisibleRegionSelection().catch(() => undefined)
    try {
      await Promise.all(allCaptures.map(capture =>
        targetSurface.discardCapture(capture.evidence.artifactId)))
      await targetSurface.clearVisualFeedback()
      await draftStore.replace({ captures: [], annotations: [], pendingArtifactDiscards: [] })
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
    if (targetSurface === null || annotations.length === 0 || busy) return
    const targetGeneration = generation
    busy = true
    active = false
    reportError(null)
    await validateCaptureArtifacts()
    const currentCaptures = captures
    const currentAnnotations = annotations
    const operation = (async () => {
      try {
        await targetSurface.cancelVisibleRegionSelection().catch(() => undefined)
        await finalizePendingArtifactDiscards()
        await deliver(currentCaptures, currentAnnotations)
        await targetSurface.clearVisualFeedback().catch(error => reportError(errorMessage(error)))
        if (isCurrent(targetSurface, targetGeneration)) resetState(false)
        try {
          await draftStore.replace(artifacts.hasPendingDiscards
            ? draftData()
            : { captures: [], annotations: [], pendingArtifactDiscards: [] })
          if (saveError?.startsWith('Could not clear sent visual feedback:')) saveError = null
        } catch (error) {
          saveError = `Could not clear sent visual feedback: ${errorMessage(error)}`
          reportError(`${saveError}. Retry saving to remove the stale local draft.`)
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
    await restoration
    const inFlightSend = pendingSend
    if (inFlightSend !== null) await inFlightSend

    destroyed = true
    generation += 1
    const previousSurface = surface
    const resourceCleanup = previousSurface === null
      ? Promise.resolve()
      : Promise.allSettled([
          previousSurface.cancelVisibleRegionSelection(),
          previousSurface.clearVisualFeedback(),
        ]).then(() => undefined)
    const artifactCleanup = artifacts.release(previousSurface, captures)
    surface = null
    resetState(false)

    await Promise.all([resourceCleanup, artifactCleanup])
    await draftStore.replace(draftData())
      .catch(error => reportError(`Could not persist destroyed visual feedback cleanup: ${errorMessage(error)}`))
  }

  restoration = restoreDraft()
  return {
    get active() { return active },
    get busy() { return busy },
    get canUndo() { return undoSnapshot !== null },
    get saveError() { return saveError },
    get captures() { return captures },
    get annotations() { return annotations },
    setErrorHandler,
    setAppearance,
    setSurface,
    toggle,
    updateAnnotation,
    removeAnnotation,
    removeCapture,
    undo,
    retrySave,
    discard,
    send,
    destroy,
  }
}
