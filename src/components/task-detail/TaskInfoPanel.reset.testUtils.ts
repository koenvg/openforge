import { clearCollapsedSections } from '@openforge-app/plugin-sdk/collapsibleSectionState'
import {
  addTaskLabel,
  getProjectTaskLabels,
  removeTaskLabel,
  updateTaskSourceTicketUrl,
  writeClipboardText,
} from '../../lib/ipc'
import { clearComponentRegistry } from '../../lib/plugin/componentRegistry'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import {
  activeSessions,
  dependencyReferenceTasks,
  mergingTaskIds,
  projects,
  tasks,
  ticketPrs,
} from '../../lib/stores'
import { vi } from 'vitest'
import { bugLabel } from './TaskInfoPanel.testFixtures'

function resetTaskInfoPanelTestState(): void {
  vi.clearAllMocks()
  vi.mocked(getProjectTaskLabels).mockResolvedValue([])
  vi.mocked(addTaskLabel).mockResolvedValue(bugLabel)
  vi.mocked(removeTaskLabel).mockResolvedValue(undefined)
  vi.mocked(updateTaskSourceTicketUrl).mockResolvedValue(undefined)
  vi.mocked(writeClipboardText).mockResolvedValue(undefined)
  localStorage.clear()
  clearCollapsedSections()
  activeSessions.set(new Map())
  ticketPrs.set(new Map())
  mergingTaskIds.set(new Set())
  projects.set([])
  tasks.set([])
  dependencyReferenceTasks.set([])
  installedPlugins.set(new Map())
  enabledPluginIds.set(new Set())
  runtimeContributionSources.set(new Map())
  clearComponentRegistry()
}

export { resetTaskInfoPanelTestState }
