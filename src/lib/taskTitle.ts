import { getTaskLabels, hasLabelNamed } from './taskLabels'
import type { Task } from './types'

/** Label the code-cleanup feature attaches to the tasks it asks agents to file. */
const CLEANUP_LABEL = 'cleanup'
const CLEANUP_TITLE_PREFIX = '[CLEANUP]'

export function getTaskTitle(task: Pick<Task, 'id' | 'initial_prompt' | 'prompt' | 'title'>): string {
  const explicitTitle = task.title?.trim()
  if (explicitTitle) {
    return explicitTitle
  }
  for (const text of [task.initial_prompt, task.prompt]) {
    if (!text) continue
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        return trimmed
      }
    }
  }
  return task.id
}

/**
 * Title as rendered on the board and task detail. Tasks carrying the cleanup label get
 * a `[CLEANUP]` prefix so they stand out among hand-written ones.
 *
 * The prefix is applied here rather than stored so it survives whichever title the task
 * ends up with — the prompt-derived one while it sits in the backlog, or the generated
 * one once an agent has run. Storing it would defeat that: generated titles only ever
 * write into an empty title, so a stored prefix would lock the task out of title
 * generation entirely. Keeping it out of the stored value also leaves `getTaskTitle`
 * free of the prefix, which is what rename edits and saves.
 */
export function getTaskDisplayTitle(task: Task): string {
  const title = getTaskTitle(task)
  if (!hasLabelNamed(getTaskLabels(task), CLEANUP_LABEL)) {
    return title
  }
  // An agent that already prefixed its own prompt should not end up double-prefixed.
  return title.toLowerCase().startsWith(CLEANUP_TITLE_PREFIX.toLowerCase())
    ? title
    : `${CLEANUP_TITLE_PREFIX} ${title}`
}
