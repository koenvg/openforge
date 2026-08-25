import { vi } from 'vitest'
import { resetSettingsViewProjectStores } from './SettingsView.projectStores.testFixture'
import { resetSettingsViewRenderIpc } from './SettingsView.renderIpc.testFixture'

vi.mock('../../lib/ipc', async () => {
  const { settingsViewRenderIpc } = await import('./SettingsView.renderIpc.testFixture')
  return settingsViewRenderIpc
})

export function resetSettingsViewNavigationTest() {
  vi.clearAllMocks()
  resetSettingsViewRenderIpc()
  resetSettingsViewProjectStores()
}
