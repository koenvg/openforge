import type { BrowserSurfaceCapture, BrowserSurfaceRegion } from '@openforge-app/plugin-sdk/frontend'
import type { Task } from '@openforge-app/plugin-sdk'

export interface VisualFeedbackReportAnnotation {
  number: number
  rect: BrowserSurfaceRegion
  comment: string
  capture: BrowserSurfaceCapture
}

function inlineCode(value: string): string {
  return `\`${value.replaceAll('`', '\\`')}\``
}

function taskTitle(task: Task): string {
  const explicitTitle = task.title?.trim()
  if (explicitTitle) return explicitTitle
  return task.initial_prompt.split('\n', 1)[0].trim() || 'Untitled Task'
}

function markerSection(annotation: VisualFeedbackReportAnnotation): string {
  const { capture, rect } = annotation
  const quotedComment = annotation.comment
    .split('\n')
    .map(line => `> ${line}`.trimEnd())
    .join('\n')

  return [
    `## Marker ${annotation.number}`,
    '',
    `- URL: ${capture.url}`,
    `- Title: ${capture.title}`,
    `- Captured: ${capture.capturedAt}`,
    `- Viewport: ${capture.width} × ${capture.height}`,
    `- PNG: ${inlineCode(capture.absolutePath)}`,
    `- Region: x=${rect.x}, y=${rect.y}, width=${rect.width}, height=${rect.height}`,
    '',
    'Comment:',
    '',
    quotedComment,
  ].join('\n')
}

export function formatVisualFeedbackReport(
  task: Task,
  annotations: readonly VisualFeedbackReportAnnotation[],
): string {
  const orderedMarkers = [...annotations].sort((left, right) => left.number - right.number)
  return [
    '# Task Browser visual feedback',
    '',
    `Task: ${inlineCode(task.id)} — ${taskTitle(task)}`,
    '',
    ...orderedMarkers.flatMap(marker => [markerSection(marker), '']),
  ].join('\n')
}
