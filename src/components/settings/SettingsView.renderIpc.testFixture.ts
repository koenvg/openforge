import { vi } from 'vitest'

export const settingsViewRenderIpc = {
  getProjectConfig: vi.fn(),
  getConfig: vi.fn(),
  checkOpenCodeInstalled: vi.fn(() => Promise.resolve({ installed: false, path: null, version: null })),
  checkClaudeInstalled: vi.fn(),
  checkPiInstalled: vi.fn(),
  checkCodexInstalled: vi.fn(() => Promise.resolve({ installed: false, path: null, version: null })),
  checkGrokInstalled: vi.fn(() => Promise.resolve({ installed: false, path: null, version: null, authenticated: false })),
  getAllWhisperModelStatuses: vi.fn(),
  getGlobalPluginDefaults: vi.fn(() => Promise.resolve([])),
}

export function resetSettingsViewRenderIpc() {
  settingsViewRenderIpc.getProjectConfig.mockResolvedValue(null)
  settingsViewRenderIpc.getConfig.mockResolvedValue(null)
  settingsViewRenderIpc.checkClaudeInstalled.mockResolvedValue({ installed: false, path: null, version: null, authenticated: false })
  settingsViewRenderIpc.checkPiInstalled.mockResolvedValue({ installed: false, path: null, version: null })
  settingsViewRenderIpc.getAllWhisperModelStatuses.mockResolvedValue([])
}
