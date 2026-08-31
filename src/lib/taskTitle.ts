export interface TaskTitleSource {
  id: string
  title: string | null
  prompt?: string | null
}

export function getTaskTitle(task: TaskTitleSource): string {
  const explicitTitle = task.title?.trim()
  if (explicitTitle) {
    return explicitTitle
  }
  const prompt = task.prompt?.trim()
  if (prompt) {
    return prompt.split(/\r?\n/).find((line) => line.trim())?.trim() ?? task.id
  }
  return task.id
}
