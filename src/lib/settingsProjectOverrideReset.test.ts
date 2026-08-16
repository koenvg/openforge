import { expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  clearProjectConfig: vi.fn(),
  resetProjectSettingsToGlobal: vi.fn(),
}))

import { clearProjectConfig } from './ipc'
import { resetProjectSettingAndReload } from './settingsProjectSync'

it('clears one project override before reloading inherited values', async () => {
  vi.mocked(clearProjectConfig).mockResolvedValue(undefined)
  const reload = vi.fn().mockResolvedValue(undefined)

  await resetProjectSettingAndReload('P-1', 'ai_provider', reload)

  expect(clearProjectConfig).toHaveBeenCalledWith('P-1', 'ai_provider')
  expect(reload).toHaveBeenCalledOnce()
})
