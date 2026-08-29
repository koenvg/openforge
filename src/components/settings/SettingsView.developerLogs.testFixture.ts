import { vi } from 'vitest'
import { resetSettingsViewProjectStores } from './SettingsView.projectStores.testFixture'
import { resetSettingsViewRenderIpc } from './SettingsView.renderIpc.testFixture'

const developerLogsIpc = vi.hoisted(() => ({
  getDeveloperLogSnapshot: vi.fn(),
  getDeveloperLogs: vi.fn(() => Promise.resolve([])),
  openInEditor: vi.fn(() => Promise.resolve(undefined)),
  getProcessMemoryHistory: vi.fn(() => Promise.resolve({
    enabled: false,
    sampleIntervalSeconds: 60,
    maxSamples: 60,
    rssSemantics: 'Inclusive process-tree RSS totals can overlap.',
    samples: [],
  })),
  setProcessMemoryHistoryEnabled: vi.fn(),
}))

vi.mock('../../lib/ipc', async () => {
  const { settingsViewRenderIpc } = await import('./SettingsView.renderIpc.testFixture')
  return { ...settingsViewRenderIpc, ...developerLogsIpc }
})

export function resetSettingsViewDeveloperLogsTest() {
  vi.clearAllMocks()
  resetSettingsViewRenderIpc()
  resetSettingsViewProjectStores()
}
