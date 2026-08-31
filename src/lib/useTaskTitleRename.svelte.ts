import { updateTaskTitle } from './ipc'
import { getTaskTitle, type TaskTitleSource } from './taskTitle'
import { error } from './stores'
import { updateTaskDetail } from './tasksState'
import { buildTaskPromptPreview, resolveTaskProjectionTitle } from './taskDetail'

type RenamableTask = TaskTitleSource

/**
 * Inline title-rename state machine shared by the task detail header and the board
 * card. `getTask` is a closure so callers can pass a reactive task; `onSaved` is an
 * optional refresh (e.g. reload tasks) run after a successful save.
 */
export function createTaskTitleRename(
  getTask: () => RenamableTask,
  onSaved?: () => void | Promise<void>,
) {
  let editing = $state(false)
  let draft = $state('')

  function start() {
    draft = getTaskTitle(getTask())
    editing = true
  }

  // Single-commit guard: a keydown and the unmount blur can both fire, so the early
  // return ensures the title is saved at most once per edit.
  async function finish(commit: boolean) {
    if (!editing) return
    editing = false
    if (!commit) return
    try {
      const task = getTask()
      await updateTaskTitle(task.id, draft)
      const explicitTitle = draft.trim()
      updateTaskDetail(task.id, (detail) => {
        const preview = buildTaskPromptPreview(detail.prompt)
        const title = resolveTaskProjectionTitle(detail.id, explicitTitle, preview)
        return {
          ...detail,
          title,
          titleSource: explicitTitle ? 'manual' : null,
        }
      })
      await onSaved?.()
    } catch (e) {
      console.error('Failed to rename task:', e)
      error.set(String(e))
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void finish(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      void finish(false)
    }
  }

  return {
    get editing() {
      return editing
    },
    get draft() {
      return draft
    },
    set draft(value: string) {
      draft = value
    },
    start,
    finish,
    handleKeydown,
  }
}
