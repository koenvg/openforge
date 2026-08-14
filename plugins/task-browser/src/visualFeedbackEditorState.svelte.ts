import type {
  BrowserSurfaceCapture,
  BrowserSurfaceRegion,
  TaskBrowserSurfaceController,
} from '@openforge-app/plugin-sdk/frontend'

export interface VisualFeedbackCapture {
  number: number
  evidence: BrowserSurfaceCapture
  artifactState: 'available' | 'missing' | 'unknown'
  artifactError: string | null
}

export interface CaptureAnnotation {
  number: number
  captureNumber: number
  rect: BrowserSurfaceRegion
  comment: string
}

export interface VisualFeedbackDraftPersistence {
  load(): Promise<unknown>
  save(draft: PersistedVisualFeedbackDraft): Promise<void>
  clear(): Promise<void>
}

export interface PersistedVisualFeedbackDraft {
  version: 1
  captures: Array<{
    number: number
    evidence: Omit<BrowserSurfaceCapture, 'dataUrl'>
  }>
  annotations: CaptureAnnotation[]
  pendingArtifactDiscards: Array<{
    number: number
    evidence: Omit<BrowserSurfaceCapture, 'dataUrl'>
  }>
}

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

function parsePersistedCaptures(value: unknown): PersistedVisualFeedbackDraft['captures'] | null {
  if (!Array.isArray(value)) return null
  const captures: PersistedVisualFeedbackDraft['captures'] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
    const capture = entry as Record<string, unknown>
    const evidence = capture.evidence
    if (typeof capture.number !== 'number' || !Number.isSafeInteger(capture.number) || capture.number <= 0
      || typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) return null
    const item = evidence as Record<string, unknown>
    if (typeof item.artifactId !== 'string' || typeof item.absolutePath !== 'string'
      || item.mediaType !== 'image/png' || typeof item.width !== 'number' || typeof item.height !== 'number'
      || typeof item.url !== 'string' || typeof item.title !== 'string' || typeof item.capturedAt !== 'string') return null
    captures.push({
      number: capture.number,
      evidence: {
        artifactId: item.artifactId,
        absolutePath: item.absolutePath,
        mediaType: 'image/png',
        width: item.width,
        height: item.height,
        url: item.url,
        title: item.title,
        capturedAt: item.capturedAt,
      },
    })
  }
  return captures
}
function parseDraft(value: unknown): PersistedVisualFeedbackDraft | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const draft = value as Record<string, unknown>
  if (draft.version !== 1 || !Array.isArray(draft.captures) || !Array.isArray(draft.annotations)) return null
  const captures = parsePersistedCaptures(draft.captures)
  const pendingArtifactDiscards = parsePersistedCaptures(draft.pendingArtifactDiscards ?? [])
  if (captures === null || pendingArtifactDiscards === null) return null
  const annotations: CaptureAnnotation[] = []
  for (const entry of draft.annotations) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
    const annotation = entry as Record<string, unknown>
    const rect = annotation.rect
    if (typeof annotation.number !== 'number' || !Number.isSafeInteger(annotation.number) || annotation.number <= 0
      || typeof annotation.captureNumber !== 'number' || !Number.isSafeInteger(annotation.captureNumber)
      || typeof annotation.comment !== 'string' || annotation.comment.trim().length === 0
      || typeof rect !== 'object' || rect === null || Array.isArray(rect)) return null
    const region = rect as Record<string, unknown>
    if (![region.x, region.y, region.width, region.height].every(item => typeof item === 'number' && Number.isFinite(item))) return null
    annotations.push({
      number: annotation.number,
      captureNumber: annotation.captureNumber,
      comment: annotation.comment,
      rect: {
        x: region.x as number,
        y: region.y as number,
        width: region.width as number,
        height: region.height as number,
      },
    })
  }
  const captureNumbers = new Set(captures.map(capture => capture.number))
  return annotations.every(annotation => captureNumbers.has(annotation.captureNumber))
    ? { version: 1, captures, annotations, pendingArtifactDiscards }
    : null
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
  let pendingArtifactDiscards: VisualFeedbackCapture[] = []
  let saveError = $state<string | null>(null)
  let persistenceQueue = Promise.resolve()
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

  function persistedDraft(): PersistedVisualFeedbackDraft {
    return {
      version: 1,
      captures: captures.map(capture => {
        const { dataUrl: _dataUrl, ...evidence } = capture.evidence
        return { number: capture.number, evidence }
      }),
      annotations: annotations.map(annotation => ({ ...annotation, rect: { ...annotation.rect } })),
      pendingArtifactDiscards: pendingArtifactDiscards.map(capture => {
        const { dataUrl: _dataUrl, ...evidence } = capture.evidence
        return { number: capture.number, evidence }
      }),
    }
  }

  async function persistDraft(): Promise<void> {
    if (persistence === undefined) return
    const draft = persistedDraft()
    const operation = persistenceQueue.then(() => draft.annotations.length === 0 && draft.pendingArtifactDiscards.length === 0
      ? persistence.clear()
      : persistence.save(draft))
    persistenceQueue = operation.catch(() => undefined)
    try {
      await operation
      if (saveError?.startsWith('Could not save visual feedback:')) saveError = null
    } catch (error) {
      saveError = `Could not save visual feedback: ${errorMessage(error)}`
      reportError(`${saveError}. Your in-memory feedback is still available; retry saving when ready.`)
    }
  }

  async function restoreDraft(): Promise<void> {
    if (persistence === undefined) return
    try {
      const stored = await persistence.load()
      if (stored === null) return
      const draft = parseDraft(stored)
      if (draft === null) {
        saveError = 'Saved visual feedback is invalid and could not be restored'
        reportError(`${saveError}. The live Browser Surface remains available.`)
        return
      }
      captures = draft.captures.map(capture => ({
        number: capture.number,
        evidence: { ...capture.evidence, dataUrl: '' },
        artifactState: 'unknown',
        artifactError: null,
      }))
      annotations = draft.annotations.map(annotation => ({ ...annotation, rect: { ...annotation.rect } }))
      pendingArtifactDiscards = draft.pendingArtifactDiscards.map(capture => ({
        number: capture.number,
        evidence: { ...capture.evidence, dataUrl: '' },
        artifactState: 'unknown',
        artifactError: null,
      }))
      nextCaptureNumber = Math.max(0, ...captures.map(capture => capture.number)) + 1
      nextAnnotationNumber = Math.max(0, ...annotations.map(annotation => annotation.number)) + 1
    } catch (error) {
      saveError = `Could not restore visual feedback: ${errorMessage(error)}`
      reportError(`${saveError}. The live Browser Surface remains available.`)
    }
  }

  async function validateCaptureArtifacts(): Promise<void> {
    const targetSurface = surface
    if (targetSurface === null || captures.length === 0) return
    const targetGeneration = generation
    const statuses = await Promise.all(captures.map(async capture => {
      try {
        const available = await targetSurface.captureExists(capture.evidence.artifactId)
        return {
          ...capture,
          artifactState: available ? 'available' as const : 'missing' as const,
          artifactError: available ? null : `Background capture is missing at ${capture.evidence.absolutePath}`,
        }
      } catch (error) {
        return {
          ...capture,
          artifactState: 'unknown' as const,
          artifactError: `Could not verify background capture: ${errorMessage(error)}`,
        }
      }
    }))
    if (!isCurrent(targetSurface, targetGeneration)) return
    captures = statuses
    const unavailable = statuses.find(capture => capture.artifactState !== 'available')
    if (unavailable?.artifactError) reportError(unavailable.artifactError)
  }

  async function syncVisualFeedback(): Promise<void> {
    const targetSurface = surface
    if (targetSurface === null) return
    const feedback = annotations.map(annotation => {
      const capture = captures.find(candidate => candidate.number === annotation.captureNumber)
      return {
        annotationNumber: annotation.number,
        url: capture?.evidence.url ?? '',
        region: { ...annotation.rect },
        comment: annotation.comment,
      }
    }).filter(marker => marker.url.length > 0)
    try {
      await targetSurface.replaceVisualFeedback(feedback)
      if (saveError?.startsWith('Could not save live marker changes:')) saveError = null
    } catch (error) {
      saveError = `Could not save live marker changes: ${errorMessage(error)}`
      reportError(`${saveError}. Retry when the Browser Surface is available.`)
    }
  }

  async function finalizePendingArtifactDiscards(): Promise<void> {
    const targetSurface = surface
    if (targetSurface === null || pendingArtifactDiscards.length === 0) return
    const pending = pendingArtifactDiscards
    pendingArtifactDiscards = []
    const outcomes = await Promise.allSettled(pending.map(capture =>
      targetSurface.discardCapture(capture.evidence.artifactId)))
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') pendingArtifactDiscards.push(pending[index])
    })
    const failure = outcomes.find(outcome => outcome.status === 'rejected')
    if (failure?.status === 'rejected') {
      saveError = `Could not remove an unreferenced background capture: ${errorMessage(failure.reason)}`
      reportError(`${saveError}. Cleanup can be retried safely.`)
    } else if (saveError?.startsWith('Could not remove an unreferenced background capture:')) {
      saveError = null
    }
  }

  async function beginMutation(): Promise<void> {
    await finalizePendingArtifactDiscards()
    undoSnapshot = snapshot()
  }

  function resetState(): void {
    active = false
    busy = false
    captures = []
    annotations = []
    nextCaptureNumber = 1
    nextAnnotationNumber = 1
    undoSnapshot = null
    pendingArtifactDiscards = []
  }

  async function releaseSurfaceResources(
    targetSurface: TaskBrowserSurfaceController,
    currentCaptures: readonly VisualFeedbackCapture[],
  ): Promise<VisualFeedbackCapture[]> {
    const outcomes = await Promise.allSettled([
      targetSurface.cancelVisibleRegionSelection(),
      targetSurface.clearVisualFeedback(),
      ...currentCaptures.map(capture => targetSurface.discardCapture(capture.evidence.artifactId)),
    ])
    return currentCaptures.filter((_capture, index) => outcomes[index + 2]?.status === 'rejected')
  }

  async function setSurface(nextSurface: TaskBrowserSurfaceController | null): Promise<void> {
    await restoration
    if (surface === nextSurface) return

    generation += 1
    const previousSurface = surface
    active = false
    surface = nextSurface
    if (nextSurface !== null && pendingArtifactDiscards.length > 0 && undoSnapshot === null) {
      await finalizePendingArtifactDiscards()
      await persistDraft()
    }
    if (previousSurface !== null) {
      await previousSurface.cancelVisibleRegionSelection().catch(() => undefined)
    }
    if (nextSurface !== null && annotations.length > 0) {
      await validateCaptureArtifacts()
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
    await beginMutation()
    annotations = annotations.filter(annotation => annotation.number !== annotationNumber)
    const stillReferenced = annotations.some(annotation => annotation.captureNumber === existing.captureNumber)
    if (!stillReferenced) {
      const removedCapture = captures.find(capture => capture.number === existing.captureNumber)
      if (removedCapture !== undefined) pendingArtifactDiscards.push(removedCapture)
      captures = captures.filter(capture => capture.number !== existing.captureNumber)
    }
    await syncVisualFeedback()
    await persistDraft()
  }

  async function removeCapture(captureNumber: number): Promise<void> {
    const removedCapture = captures.find(capture => capture.number === captureNumber)
    if (removedCapture === undefined || busy) return
    await beginMutation()
    captures = captures.filter(capture => capture.number !== captureNumber)
    annotations = annotations.filter(annotation => annotation.captureNumber !== captureNumber)
    pendingArtifactDiscards.push(removedCapture)
    await syncVisualFeedback()
    await persistDraft()
  }

  async function undo(): Promise<void> {
    const previous = undoSnapshot
    if (previous === null || busy) return
    const currentCaptures = captures
    const restoredIds = new Set(previous.captures.map(capture => capture.evidence.artifactId))
    pendingArtifactDiscards = pendingArtifactDiscards
      .filter(capture => !restoredIds.has(capture.evidence.artifactId))
    pendingArtifactDiscards.push(...currentCaptures
      .filter(capture => !restoredIds.has(capture.evidence.artifactId)))
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
    const allCaptures = Array.from(new Map([...currentCaptures, ...pendingArtifactDiscards]
      .map(capture => [capture.evidence.artifactId, capture])).values())
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
      await persistenceQueue
      await persistence?.clear()
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
        if (isCurrent(targetSurface, targetGeneration)) {
          const cleanupPending = pendingArtifactDiscards
          resetState()
          pendingArtifactDiscards = cleanupPending
        }
        try {
          await persistenceQueue
          if (pendingArtifactDiscards.length > 0) await persistence?.save(persistedDraft())
          else await persistence?.clear()
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
    const previousCaptures = Array.from(new Map([...captures, ...pendingArtifactDiscards]
      .map(capture => [capture.evidence.artifactId, capture])).values())
    surface = null
    resetState()

    const failedCaptures = previousSurface === null
      ? previousCaptures
      : await releaseSurfaceResources(previousSurface, previousCaptures)
    pendingArtifactDiscards = failedCaptures
    await persistenceQueue
    await (failedCaptures.length > 0
      ? persistence?.save(persistedDraft())
      : persistence?.clear())
      ?.catch(error => reportError(`Could not persist destroyed visual feedback cleanup: ${errorMessage(error)}`))
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
