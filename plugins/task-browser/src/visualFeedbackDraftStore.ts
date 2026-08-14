import type {
  CaptureAnnotation,
  PersistedVisualFeedbackDraft,
  VisualFeedbackCapture,
  VisualFeedbackDraftData,
  VisualFeedbackDraftPersistence,
} from './visualFeedbackEditorTypes'

export class InvalidVisualFeedbackDraftError extends Error {
  constructor() {
    super('Saved visual feedback is invalid and could not be restored')
    this.name = 'InvalidVisualFeedbackDraftError'
  }
}

export interface VisualFeedbackDraftStore {
  restore(): Promise<VisualFeedbackDraftData | null>
  persist(data: VisualFeedbackDraftData): Promise<void>
  replace(data: VisualFeedbackDraftData): Promise<void>
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

function restoreCapture(
  capture: PersistedVisualFeedbackDraft['captures'][number],
): VisualFeedbackCapture {
  return {
    number: capture.number,
    evidence: { ...capture.evidence, dataUrl: '' },
    artifactState: 'unknown',
    artifactError: null,
  }
}

function serializeCapture(capture: VisualFeedbackCapture): PersistedVisualFeedbackDraft['captures'][number] {
  const { dataUrl: _dataUrl, ...evidence } = capture.evidence
  return { number: capture.number, evidence }
}

function serializeDraft(data: VisualFeedbackDraftData): PersistedVisualFeedbackDraft {
  return {
    version: 1,
    captures: data.captures.map(serializeCapture),
    annotations: data.annotations.map(annotation => ({ ...annotation, rect: { ...annotation.rect } })),
    pendingArtifactDiscards: data.pendingArtifactDiscards.map(serializeCapture),
  }
}

function shouldClear(draft: PersistedVisualFeedbackDraft): boolean {
  return draft.annotations.length === 0 && draft.pendingArtifactDiscards.length === 0
}

export function createVisualFeedbackDraftStore(
  persistence: VisualFeedbackDraftPersistence | undefined,
): VisualFeedbackDraftStore {
  let persistenceQueue = Promise.resolve()

  async function restore(): Promise<VisualFeedbackDraftData | null> {
    if (persistence === undefined) return null
    const stored = await persistence.load()
    if (stored === null) return null
    const draft = parseDraft(stored)
    if (draft === null) throw new InvalidVisualFeedbackDraftError()
    return {
      captures: draft.captures.map(restoreCapture),
      annotations: draft.annotations.map(annotation => ({ ...annotation, rect: { ...annotation.rect } })),
      pendingArtifactDiscards: draft.pendingArtifactDiscards.map(restoreCapture),
    }
  }

  async function persist(data: VisualFeedbackDraftData): Promise<void> {
    if (persistence === undefined) return
    const draft = serializeDraft(data)
    const operation = persistenceQueue.then(() => shouldClear(draft)
      ? persistence.clear()
      : persistence.save(draft))
    persistenceQueue = operation.catch(() => undefined)
    await operation
  }

  async function replace(data: VisualFeedbackDraftData): Promise<void> {
    if (persistence === undefined) return
    const draft = serializeDraft(data)
    await persistenceQueue
    if (shouldClear(draft)) await persistence.clear()
    else await persistence.save(draft)
  }

  return { restore, persist, replace }
}
