import type { BrowserSurfaceCapture, BrowserSurfaceRegion } from '@openforge-app/plugin-sdk/frontend'

export interface VisualFeedbackReportCapture {
  number: number
  evidence: BrowserSurfaceCapture
}

export interface VisualFeedbackReportAnnotation {
  number: number
  captureNumber: number
  rect: BrowserSurfaceRegion
  comment: string
}

function inlineCode(value: string): string {
  return `\`${value.replaceAll('`', '\\`')}\``
}
function annotationSection(annotation: VisualFeedbackReportAnnotation): string {
  const quotedComment = annotation.comment
    .split('\n')
    .map(line => `> ${line}`.trimEnd())
    .join('\n')

  return [
    `### Annotation ${annotation.number}`,
    '',
    `- Region: x=${annotation.rect.x}, y=${annotation.rect.y}, width=${annotation.rect.width}, height=${annotation.rect.height}`,
    '',
    'Comment:',
    '',
    quotedComment,
  ].join('\n')
}

function captureSection(
  capture: VisualFeedbackReportCapture,
  annotations: readonly VisualFeedbackReportAnnotation[],
): string {
  const evidence = capture.evidence
  const orderedAnnotations = annotations
    .filter(annotation => annotation.captureNumber === capture.number)
    .sort((left, right) => left.number - right.number)

  return [
    `## Capture ${capture.number}`,
    '',
    `- URL: ${evidence.url}`,
    `- Title: ${evidence.title}`,
    `- Captured: ${evidence.capturedAt}`,
    `- Viewport: ${evidence.width} × ${evidence.height}`,
    `- PNG: ${inlineCode(evidence.absolutePath)}`,
    '',
    orderedAnnotations.map(annotationSection).join('\n\n'),
  ].join('\n')
}

export function formatVisualFeedbackReport(
  captures: readonly VisualFeedbackReportCapture[],
  annotations: readonly VisualFeedbackReportAnnotation[],
): string {
  const orderedCaptures = [...captures].sort((left, right) => left.number - right.number)
  return [
    '# Task Browser visual feedback',
    '',
    ...orderedCaptures.flatMap(capture => [captureSection(capture, annotations), '']),
  ].join('\n')
}
