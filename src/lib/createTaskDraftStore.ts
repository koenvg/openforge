import type { TaskPromptImage } from './taskPrompt'

export interface RetainedCreateTaskDraft {
  prompt: string
  images: TaskPromptImage[]
}

const draftsByProjectId = new Map<string, RetainedCreateTaskDraft>()

function copy(draft: RetainedCreateTaskDraft): RetainedCreateTaskDraft {
  return { prompt: draft.prompt, images: draft.images.map((image) => ({ ...image })) }
}

export function readCreateTaskDraft(projectId: string): RetainedCreateTaskDraft | null {
  const retained = draftsByProjectId.get(projectId)
  return retained ? copy(retained) : null
}

export function writeCreateTaskDraft(projectId: string, draft: RetainedCreateTaskDraft): void {
  draftsByProjectId.set(projectId, copy(draft))
}

export function clearCreateTaskDraft(projectId: string): void {
  draftsByProjectId.delete(projectId)
}

export function clearAllCreateTaskDrafts(): void {
  draftsByProjectId.clear()
}
