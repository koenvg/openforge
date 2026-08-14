import type { BrowserSurfaceCapture, BrowserSurfaceRegion } from '@openforge-app/plugin-sdk/frontend'

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

export interface VisualFeedbackDraftData {
  captures: VisualFeedbackCapture[]
  annotations: CaptureAnnotation[]
  pendingArtifactDiscards: VisualFeedbackCapture[]
}
