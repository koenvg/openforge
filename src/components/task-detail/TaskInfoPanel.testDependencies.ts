import {
  addTaskLabel,
  getProjectTaskLabels,
  removeTaskLabel,
  writeClipboardText,
} from '../../lib/ipc'
import {
  activeSessions,
  dependencyReferenceTasks,
  mergingTaskIds,
  projects,
  tasks,
  ticketPrs,
} from '../../lib/stores'

function getTaskInfoPanelTestDependencies() {
  return {
    activeSessions,
    addTaskLabel,
    dependencyReferenceTasks,
    getProjectTaskLabels,
    mergingTaskIds,
    projects,
    removeTaskLabel,
    tasks,
    ticketPrs,
    writeClipboardText,
  }
}

export { getTaskInfoPanelTestDependencies }
