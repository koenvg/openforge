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
import { resetTaskDetailViewTerminalPoolMocks } from './TaskDetailView.terminalSessionService.testUtils'

function resetTaskDetailViewTestState() {
  localStorage.clear()
  taskActiveView.set(new Map())
  taskRuntimeInfo.set(new Map())
  completingTasks.set(new Set())
  commandHeld.set(false)
  outOfFocusTaskIdsByProject.set(new Map())
  ;(tasks as unknown as { set(value: never[]): void }).set([])
  resetTaskDetailViewTerminalPoolMocks()
  clearTerminalTaskPaneControllers()
  resetTaskDetailViewPluginSetup()
}

export { resetTaskDetailViewTestState }
