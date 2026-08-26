import {
  addTaskLabel,
  getProjectTaskLabels,
  removeTaskLabel,
  updateTaskSourceTicketUrl,
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
    updateTaskSourceTicketUrl,
    writeClipboardText,
  }
}

export { getTaskInfoPanelTestDependencies }
