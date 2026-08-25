import { afterEach, beforeEach, vi } from 'vitest'
import { resetSettingsViewProjectStores } from './SettingsView.projectStores.testFixture'
import { resetSettingsViewRenderIpc } from './SettingsView.renderIpc.testFixture'

const persistenceIpc = vi.hoisted(() => ({
  setProjectConfig: vi.fn(),
  updateProject: vi.fn(),
  setConfig: vi.fn(),
}))

vi.mock('../../lib/ipc', async () => {
  const { settingsViewRenderIpc } = await import('./SettingsView.renderIpc.testFixture')
  return { ...settingsViewRenderIpc, ...persistenceIpc }
})

export function setupSettingsViewAutosaveSuite() {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetSettingsViewRenderIpc()
    resetSettingsViewProjectStores()
    persistenceIpc.setProjectConfig.mockResolvedValue(undefined)
    persistenceIpc.updateProject.mockResolvedValue(undefined)
    persistenceIpc.setConfig.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })
}
