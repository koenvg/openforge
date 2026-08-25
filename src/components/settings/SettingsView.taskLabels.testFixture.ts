import { vi } from 'vitest'
import { resetSettingsViewProjectStores } from './SettingsView.projectStores.testFixture'
import { resetSettingsViewRenderIpc } from './SettingsView.renderIpc.testFixture'

const taskLabelsIpc = vi.hoisted(() => ({
  getProjectTaskLabels: vi.fn(),
  createTaskLabel: vi.fn(() => Promise.resolve({ id: 1, project_id: 'test-project-id', name: 'bug' })),
  deleteTaskLabel: vi.fn(() => Promise.resolve(undefined)),
}))

vi.mock('../../lib/ipc', async () => {
  const { settingsViewRenderIpc } = await import('./SettingsView.renderIpc.testFixture')
  return { ...settingsViewRenderIpc, ...taskLabelsIpc }
})

export function resetSettingsViewTaskLabelsTest() {
  vi.clearAllMocks()
  resetSettingsViewRenderIpc()
  resetSettingsViewProjectStores()
  taskLabelsIpc.getProjectTaskLabels.mockResolvedValue([])
}
