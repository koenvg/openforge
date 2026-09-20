import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig, getProjectConfig } from './ipc/config'
import {
  maybeOpenAttentionOverviewOnSend,
  notifySessionMessageSent,
  registerAttentionOverviewOpener,
} from './openAttentionOnSessionSubmit'

vi.mock('./ipc/config', () => ({
  getConfig: vi.fn(),
  getProjectConfig: vi.fn(),
}))

describe('open attention overview on session send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(getProjectConfig).mockResolvedValue(null)
  })

  it('does not open when the setting is off', async () => {
    const open = vi.fn()

    await maybeOpenAttentionOverviewOnSend(open, 'P-1')

    expect(open).not.toHaveBeenCalled()
  })

  it('opens when the global setting is on and the project has no override', async () => {
    const open = vi.fn()
    vi.mocked(getConfig).mockImplementation(async (key: string) => (
      key === 'open_attention_overview_on_send' ? 'true' : null
    ))

    await maybeOpenAttentionOverviewOnSend(open, 'P-1')

    expect(getProjectConfig).toHaveBeenCalledWith('P-1', 'open_attention_overview_on_send')
    expect(open).toHaveBeenCalledOnce()
  })

  it('lets a project override turn the global setting off', async () => {
    const open = vi.fn()
    vi.mocked(getConfig).mockResolvedValue('true')
    vi.mocked(getProjectConfig).mockResolvedValue('false')

    await maybeOpenAttentionOverviewOnSend(open, 'P-2')

    expect(open).not.toHaveBeenCalled()
  })

  it('lets a project override turn the setting on', async () => {
    const open = vi.fn()
    vi.mocked(getConfig).mockResolvedValue('false')
    vi.mocked(getProjectConfig).mockResolvedValue('true')

    await maybeOpenAttentionOverviewOnSend(open, 'P-2')

    expect(open).toHaveBeenCalledOnce()
  })

  it('does not open when config lookup fails', async () => {
    const open = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getConfig).mockRejectedValue(new Error('disk'))

    await maybeOpenAttentionOverviewOnSend(open, null)

    expect(open).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('opens through the registered host opener after a session send', async () => {
    const open = vi.fn()
    vi.mocked(getConfig).mockResolvedValue('true')
    const unregister = registerAttentionOverviewOpener({
      open,
      getProjectId: () => 'P-1',
    })

    notifySessionMessageSent()
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalledOnce()
    })

    unregister()
    open.mockClear()
    notifySessionMessageSent()
    await Promise.resolve()
    expect(open).not.toHaveBeenCalled()
  })
})
