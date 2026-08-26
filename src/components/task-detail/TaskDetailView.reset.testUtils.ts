import {
  commandHeld,
  completingTasks,
  outOfFocusTaskIdsByProject,
  taskActiveView,
  taskRuntimeInfo,
  tasks,
} from '../../lib/stores'
import { clearTerminalTaskPaneControllers } from './terminalTaskPaneController'
import { resetTaskDetailViewPluginSetup } from './TaskDetailView.pluginSetup.testUtils'
import { resetTaskDetailViewTerminalPoolMocks } from './TaskDetailView.terminalPool.testUtils'

function resetTaskDetailViewTestState() {
  localStorage.clear()
  taskActiveView.set(new Map())
  taskRuntimeInfo.set(new Map())
  completingTasks.set(new Set())
  commandHeld.set(false)
  outOfFocusTaskIdsByProject.set(new Map())
  tasks.set([])
  resetTaskDetailViewTerminalPoolMocks()
  clearTerminalTaskPaneControllers()
  resetTaskDetailViewPluginSetup()
}

export { resetTaskDetailViewTestState }
