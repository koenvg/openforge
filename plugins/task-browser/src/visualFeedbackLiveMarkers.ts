import type {
  BrowserSurfaceVisualFeedbackAppearance,
  TaskBrowserSurfaceController,
} from '@openforge-app/plugin-sdk/frontend'
import type { CaptureAnnotation, VisualFeedbackCapture } from './visualFeedbackEditorTypes'

export async function synchronizeVisualFeedbackMarkers(
  surface: TaskBrowserSurfaceController,
  captures: readonly VisualFeedbackCapture[],
  annotations: readonly CaptureAnnotation[],
  appearance: BrowserSurfaceVisualFeedbackAppearance,
): Promise<void> {
  const markers = annotations.map(annotation => {
    const capture = captures.find(candidate => candidate.number === annotation.captureNumber)
    return {
      annotationNumber: annotation.number,
      url: capture?.evidence.url ?? '',
      region: { ...annotation.rect },
      comment: annotation.comment,
    }
  }).filter(marker => marker.url.length > 0)

  await surface.replaceVisualFeedback(markers, { appearance })
}
