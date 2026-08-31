
function isImageReferenceDefinition(line: string): boolean {
  const separator = line.indexOf(':')
  if (separator < 0) return false
  const marker = line.slice(0, separator)
  const value = line.slice(separator + 1)
  const imageNumber = marker.startsWith('[image#') && marker.endsWith(']')
    ? marker.slice('[image#'.length, -1)
    : null
  return imageNumber !== null
    && imageNumber.length > 0
    && /^\d+$/u.test(imageNumber)
    && value.trimStart().startsWith('data:image/')
    && value.includes(';base64,')
}

export function buildTaskPromptPreview(prompt: string): string {
  const lines = prompt
    .split(/\r?\n/u)
    .filter((line) => !isImageReferenceDefinition(line))
  while (lines.at(-1)?.trim() === '') lines.pop()
  return [...lines.join('\n')].slice(0, 120).join('')
}

export function resolveTaskProjectionTitle(
  taskId: string,
  explicitTitle: string | null | undefined,
  preview: string,
): string {
  const title = explicitTitle?.trim()
  if (title) return title
  const fallback = preview.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) || taskId
  return [...fallback].slice(0, 120).join('')
}
