
export interface TaskPromptImageReference {
  marker: string
  dataUrl: string
  mimeType: string
  size: number
}

export interface ParsedTaskPrompt {
  text: string
  imageReferences: TaskPromptImageReference[]
}

const IMAGE_REFERENCE_LINE_PATTERN = /^(\[image#\d+\]):\s*(data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=]+))\s*$/

function dataUrlByteSize(base64Payload: string): number {
  const padding = base64Payload.endsWith('==') ? 2 : base64Payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(base64Payload.length * 3 / 4) - padding)
}

function rawTaskPromptText(task: { prompt: string }): string {
  return task.prompt
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const trimmed = [...lines]
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') {
    trimmed.pop()
  }
  return trimmed
}

export function parseTaskPrompt(prompt: string): ParsedTaskPrompt {
  const textLines: string[] = []
  const imageReferences: TaskPromptImageReference[] = []

  for (const line of prompt.split(/\r?\n/)) {
    const match = line.match(IMAGE_REFERENCE_LINE_PATTERN)
    if (!match) {
      textLines.push(line)
      continue
    }

    imageReferences.push({
      marker: match[1],
      dataUrl: match[2],
      mimeType: match[3],
      size: dataUrlByteSize(match[4]),
    })
  }

  return {
    text: trimTrailingBlankLines(textLines).join('\n'),
    imageReferences,
  }
}

export function formatTaskPromptWithImageReferences(
  prompt: string,
  imageReferences: TaskPromptImageReference[],
): string {
  const referencesInPrompt = imageReferences.filter((image) => prompt.includes(image.marker))
  if (referencesInPrompt.length === 0) return prompt

  const references = referencesInPrompt
    .map((image) => `${image.marker}: ${image.dataUrl}`)
    .join('\n')

  return `${prompt.trim()}\n\n${references}`
}

export function getTaskPromptText(task: { prompt: string }): string {
  return parseTaskPrompt(rawTaskPromptText(task)).text
}

export function getTaskPromptImageReferences(
  task: { prompt: string },
): TaskPromptImageReference[] {
  return parseTaskPrompt(rawTaskPromptText(task)).imageReferences
}
