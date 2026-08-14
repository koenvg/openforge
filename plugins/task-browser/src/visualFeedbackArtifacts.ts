import type { TaskBrowserSurfaceController } from '@openforge-app/plugin-sdk/frontend'
import type { VisualFeedbackCapture } from './visualFeedbackEditorTypes'

export interface ArtifactAvailabilityResult {
  captures: VisualFeedbackCapture[]
  firstError: string | null
}

export interface VisualFeedbackArtifacts {
  readonly pendingDiscards: readonly VisualFeedbackCapture[]
  readonly hasPendingDiscards: boolean
  restorePendingDiscards(captures: readonly VisualFeedbackCapture[]): void
  scheduleDiscard(capture: VisualFeedbackCapture): void
  reconcileUndo(
    restoredCaptures: readonly VisualFeedbackCapture[],
    replacedCaptures: readonly VisualFeedbackCapture[],
  ): void
  clearPendingDiscards(): void
  allArtifacts(captures: readonly VisualFeedbackCapture[]): VisualFeedbackCapture[]
  validateAvailability(
    surface: TaskBrowserSurfaceController,
    captures: readonly VisualFeedbackCapture[],
  ): Promise<ArtifactAvailabilityResult>
  cleanupPending(surface: TaskBrowserSurfaceController): Promise<unknown | null>
  release(
    surface: TaskBrowserSurfaceController | null,
    captures: readonly VisualFeedbackCapture[],
  ): Promise<readonly VisualFeedbackCapture[]>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createVisualFeedbackArtifacts(): VisualFeedbackArtifacts {
  let pendingDiscards: VisualFeedbackCapture[] = []

  function restorePendingDiscards(captures: readonly VisualFeedbackCapture[]): void {
    pendingDiscards = [...captures]
  }

  function scheduleDiscard(capture: VisualFeedbackCapture): void {
    pendingDiscards.push(capture)
  }

  function reconcileUndo(
    restoredCaptures: readonly VisualFeedbackCapture[],
    replacedCaptures: readonly VisualFeedbackCapture[],
  ): void {
    const restoredIds = new Set(restoredCaptures.map(capture => capture.evidence.artifactId))
    pendingDiscards = pendingDiscards.filter(capture => !restoredIds.has(capture.evidence.artifactId))
    pendingDiscards.push(...replacedCaptures.filter(capture => !restoredIds.has(capture.evidence.artifactId)))
  }

  function clearPendingDiscards(): void {
    pendingDiscards = []
  }

  function allArtifacts(captures: readonly VisualFeedbackCapture[]): VisualFeedbackCapture[] {
    return Array.from(new Map([...captures, ...pendingDiscards]
      .map(capture => [capture.evidence.artifactId, capture])).values())
  }

  async function validateAvailability(
    surface: TaskBrowserSurfaceController,
    captures: readonly VisualFeedbackCapture[],
  ): Promise<ArtifactAvailabilityResult> {
    const statuses = await Promise.all(captures.map(async capture => {
      try {
        const available = await surface.captureExists(capture.evidence.artifactId)
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
    const unavailable = statuses.find(capture => capture.artifactState !== 'available')
    return { captures: statuses, firstError: unavailable?.artifactError ?? null }
  }

  async function cleanupPending(surface: TaskBrowserSurfaceController): Promise<unknown | null> {
    if (pendingDiscards.length === 0) return null
    const pending = pendingDiscards
    pendingDiscards = []
    const outcomes = await Promise.allSettled(pending.map(capture =>
      surface.discardCapture(capture.evidence.artifactId)))
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') pendingDiscards.push(pending[index])
    })
    const failure = outcomes.find(outcome => outcome.status === 'rejected')
    return failure?.status === 'rejected' ? failure.reason : null
  }

  async function release(
    surface: TaskBrowserSurfaceController | null,
    captures: readonly VisualFeedbackCapture[],
  ): Promise<readonly VisualFeedbackCapture[]> {
    const artifacts = allArtifacts(captures)
    if (surface === null) {
      pendingDiscards = artifacts
      return pendingDiscards
    }
    pendingDiscards = []
    const outcomes = await Promise.allSettled(artifacts.map(capture =>
      surface.discardCapture(capture.evidence.artifactId)))
    pendingDiscards = artifacts.filter((_capture, index) => outcomes[index]?.status === 'rejected')
    return pendingDiscards
  }

  return {
    get pendingDiscards() { return pendingDiscards },
    get hasPendingDiscards() { return pendingDiscards.length > 0 },
    restorePendingDiscards,
    scheduleDiscard,
    reconcileUndo,
    clearPendingDiscards,
    allArtifacts,
    validateAvailability,
    cleanupPending,
    release,
  }
}
