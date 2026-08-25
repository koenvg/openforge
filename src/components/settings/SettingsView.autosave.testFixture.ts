import { vi } from 'vitest'
import { resetSettingsViewProjectStores } from './SettingsView.projectStores.testFixture'
import { resetSettingsViewRenderIpc } from './SettingsView.renderIpc.testFixture'

const persistenceIpc = vi.hoisted(() => ({
  setProjectConfig: vi.fn(),
  clearProjectConfig: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  setConfig: vi.fn(),
}))

vi.mock('../../lib/ipc', async () => {
  const { settingsViewRenderIpc } = await import('./SettingsView.renderIpc.testFixture')
  return { ...settingsViewRenderIpc, ...persistenceIpc }
})

export function resetSettingsViewAutosaveTest() {
  vi.clearAllMocks()
  resetSettingsViewRenderIpc()
  resetSettingsViewProjectStores()
  persistenceIpc.setProjectConfig.mockResolvedValue(undefined)
  persistenceIpc.clearProjectConfig.mockResolvedValue(undefined)
  persistenceIpc.updateProject.mockResolvedValue(undefined)
  persistenceIpc.deleteProject.mockResolvedValue(undefined)
  persistenceIpc.setConfig.mockResolvedValue(undefined)
}
