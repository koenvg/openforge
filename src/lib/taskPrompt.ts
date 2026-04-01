import type { Task } from './types'

export function getTaskPromptText(task: Pick<Task, 'initial_prompt' | 'prompt'>): string {
  return task.initial_prompt || task.prompt || ''
}
