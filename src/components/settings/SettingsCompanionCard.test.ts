import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCompanionGatewayStatus, setCompanionGatewayEnabled } from '../../lib/ipc'
import SettingsCompanionCard from './SettingsCompanionCard.svelte'

vi.mock('../../lib/ipc', () => ({
  getCompanionGatewayStatus: vi.fn(),
  setCompanionGatewayEnabled: vi.fn(),
}))

const disabledStatus = {
  enabled: false,
  phase: 'disabled' as const,
  hostId: null,
  certificateFingerprint: null,
  endpoints: [],
  error: null,
}

const runningStatus = {
  enabled: true,
  phase: 'running' as const,
  hostId: 'desktop-host-1',
  certificateFingerprint: 'AA:BB:CC',
  endpoints: [
    { kind: 'lan' as const, url: 'https://192.168.1.20:17424' },
    { kind: 'tailscale' as const, url: 'https://100.64.0.20:17424' },
  ],
  error: null,
}

describe('SettingsCompanionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(disabledStatus)
    vi.mocked(setCompanionGatewayEnabled).mockResolvedValue(runningStatus)
  })

  it('shows that Companion connectivity is off by default and requires OpenForge to remain running', async () => {
    render(SettingsCompanionCard)

    expect(await screen.findByText('Disabled')).toBeTruthy()
    expect(screen.getByText(/OpenForge must remain running/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enable Companion Gateway' })).toBeTruthy()
  })

  it('enables through the typed IPC boundary and renders health and offered endpoints', async () => {
    render(SettingsCompanionCard)

    await fireEvent.click(await screen.findByRole('button', { name: 'Enable Companion Gateway' }))

    expect(setCompanionGatewayEnabled).toHaveBeenCalledWith(true)
    expect(await screen.findByText('Running')).toBeTruthy()
    expect(screen.getByText('https://192.168.1.20:17424')).toBeTruthy()
    expect(screen.getByText('https://100.64.0.20:17424')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Disable Companion Gateway' })).toBeTruthy()
  })

  it('disables a running gateway and reports the resulting state', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(runningStatus)
    vi.mocked(setCompanionGatewayEnabled).mockResolvedValue(disabledStatus)
    render(SettingsCompanionCard)

    await fireEvent.click(await screen.findByRole('button', { name: 'Disable Companion Gateway' }))

    expect(setCompanionGatewayEnabled).toHaveBeenCalledWith(false)
    expect(await screen.findByText('Disabled')).toBeTruthy()
  })

  it('surfaces gateway lifecycle failures', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue({
      ...runningStatus,
      phase: 'error',
      endpoints: [],
      error: 'No reachable private network interface is available',
    })
    render(SettingsCompanionCard)

    expect(await screen.findByText('Error')).toBeTruthy()
    expect(screen.getByText('No reachable private network interface is available')).toBeTruthy()
  })
})
