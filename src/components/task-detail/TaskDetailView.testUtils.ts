// Keep mock registration imports before components that consume the mocked modules.
import './TaskDetailView.terminalRuntimeMocks.testUtils'
import './TaskDetailView.reviewMocks.testUtils'
import './TaskDetailView.storeMocks.testUtils'
import './TaskDetailView.ipcMocks.testUtils'
import './TaskDetailView.terminalSessionService.testUtils'
import './TaskDetailView.routerMocks.testUtils'

import { clearComponentRegistry, registerRenderableContributionComponent } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import {
  commandHeld,
  completingTasks,
  outOfFocusTaskIdsByProject,
  taskActiveView,
  taskRuntimeInfo,
  tasks,
} from '../../lib/stores'
import PluginSlotTestView from '../plugin/PluginSlotTestView.svelte'
import TaskDetailView from './TaskDetailView.svelte'
import TerminalTaskPane from './TerminalTaskPane.svelte'
import { TERMINAL_VIEW_ID } from './TaskDetailView.pluginSetup.testUtils'
import { resetTaskDetailViewTestState } from './TaskDetailView.reset.testUtils'
import { mockResetToBoard } from './TaskDetailView.routerMocks.testUtils'
import {
  baseTask,
  createTaskWorkspaceInfo,
  mockOnRunAction,
  secondaryTask,
} from './TaskDetailView.testFixtures'
import { taskTabSessions, terminalAttachmentDetach } from './TaskDetailView.terminalSessionService.testUtils'
import { mockRunAppCommandInTaskTerminal } from './TaskDetailView.terminalRuntimeMocks.testUtils'

function getTaskDetailViewTestDependencies() {
  return {
    PluginSlotTestView,
    TaskDetailView,
    TerminalTaskPane,
    clearComponentRegistry,
    commandHeld,
    completingTasks,
    enabledPluginIds,
    installedPlugins,
    outOfFocusTaskIdsByProject,
    registerRenderableContributionComponent,
    runtimeContributionSources,
    taskActiveView,
    taskRuntimeInfo,
    tasks,
  }
}

export {
  TERMINAL_VIEW_ID,
  baseTask,
  secondaryTask,
  mockOnRunAction,
  createTaskWorkspaceInfo,
  mockResetToBoard,
  mockRunAppCommandInTaskTerminal,
  taskTabSessions,
  terminalAttachmentDetach,
  getTaskDetailViewTestDependencies,
  resetTaskDetailViewTestState,
}
export type { Task } from './TaskDetailView.testFixtures'
