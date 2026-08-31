// Keep mock registration imports before modules that consume the mocked dependencies.
import './TaskInfoPanel.storeMocks.testUtils'
import './TaskInfoPanel.ipcMocks.testUtils'
import './TaskInfoPanel.pluginMocks.testUtils'

import { registerTaskUiSectionPlugin } from './TaskInfoPanel.pluginSetup.testUtils'
import { renderTaskInfoPanel } from './TaskInfoPanel.render.testUtils'
import { resetTaskInfoPanelTestState } from './TaskInfoPanel.reset.testUtils'
import { getTaskInfoPanelTestDependencies } from './TaskInfoPanel.testDependencies'
import {
  baseTask,
  bugLabel,
  createPullRequest,
  taskWithLabels,
  uiLabel,
} from './TaskInfoPanel.testFixtures'

export {
  baseTask,
  bugLabel,
  createPullRequest,
  getTaskInfoPanelTestDependencies,
  registerTaskUiSectionPlugin,
  renderTaskInfoPanel,
  resetTaskInfoPanelTestState,
  taskWithLabels,
  uiLabel,
}
export type { TaskDetail } from './TaskInfoPanel.testFixtures'
