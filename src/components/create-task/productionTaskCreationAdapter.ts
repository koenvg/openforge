import { createTask, listGitBranches, repoHasCommits, updateTaskInitialPrompt } from '../../lib/ipc'
import { loadTaskLevelDefaults } from '../../lib/taskDefaults'
import { ClipboardUnavailableError, type TaskCreationAdapter } from './taskCreationAdapter'

export const productionTaskCreationAdapter: TaskCreationAdapter = {
  createTask,
  updateTaskInitialPrompt,
  listGitBranches,
  repoHasCommits,
  loadTaskLevelDefaults,
  readImage(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result)
        else reject(new Error('Failed to read image'))
      }
      reader.readAsDataURL(blob)
    })
  },
  async readClipboardImage() {
    if (!navigator.clipboard?.read) throw new ClipboardUnavailableError()
    for (const item of await navigator.clipboard.read()) {
      const imageType = item.types.find((type) => type.startsWith('image/'))
      if (imageType) return item.getType(imageType)
    }
    return null
  },
}

