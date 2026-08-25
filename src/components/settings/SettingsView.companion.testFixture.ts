import { vi } from 'vitest'
import { resetSettingsViewProjectStores } from './SettingsView.projectStores.testFixture'
import { resetSettingsViewRenderIpc } from './SettingsView.renderIpc.testFixture'

const companionIpc = vi.hoisted(() => ({
  getCompanionGatewayStatus: vi.fn(),
  setCompanionGatewayEnabled: vi.fn(),
  setCompanionTailscaleHostname: vi.fn(),
}))

vi.mock('../../lib/ipc', async () => {
  const { settingsViewRenderIpc } = await import('./SettingsView.renderIpc.testFixture')
  return { ...settingsViewRenderIpc, ...companionIpc }
})

export function resetSettingsViewCompanionTest() {
  vi.clearAllMocks()
  resetSettingsViewRenderIpc()
  resetSettingsViewProjectStores()
  companionIpc.getCompanionGatewayStatus.mockResolvedValue({
    enabled: false,
    phase: 'disabled',
    hostId: null,
    certificateFingerprint: null,
    endpoints: [],
    tailscale: {
      detectedHostname: null,
      configuredHostname: null,
      effectiveHostname: null,
    },
    error: null,
  })
  companionIpc.setCompanionGatewayEnabled.mockResolvedValue(undefined)
  companionIpc.setCompanionTailscaleHostname.mockResolvedValue(undefined)
}
