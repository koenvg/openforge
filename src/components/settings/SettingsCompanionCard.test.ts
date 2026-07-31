import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approveCompanionPairing,
  cancelCompanionPairing,
  getCompanionGatewayStatus,
  getCompanionPairingStatus,
  listCompanionDevices,
  rejectCompanionPairing,
  revokeCompanionDevice,
  setCompanionGatewayEnabled,
  startCompanionPairing,
} from '../../lib/ipc'
import SettingsCompanionCard from './SettingsCompanionCard.svelte'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,pairing-qr') },
}))

vi.mock('../../lib/ipc', () => ({
  getCompanionGatewayStatus: vi.fn(),
  setCompanionGatewayEnabled: vi.fn(),
  startCompanionPairing: vi.fn(),
  getCompanionPairingStatus: vi.fn(),
  cancelCompanionPairing: vi.fn(),
  approveCompanionPairing: vi.fn(),
  rejectCompanionPairing: vi.fn(),
  listCompanionDevices: vi.fn(),
  revokeCompanionDevice: vi.fn(),
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

const pairingSession = {
  sessionId: 'pairing-session-1',
  expiresAt: '2099-01-01T00:00:00Z',
  qrPayload: '{"protocolVersion":1,"oneTimeSecret":"redacted-in-ui"}',
  pendingRequest: null,
  deliveryPending: false,
}

describe('SettingsCompanionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(disabledStatus)
    vi.mocked(setCompanionGatewayEnabled).mockResolvedValue(runningStatus)
    vi.mocked(startCompanionPairing).mockResolvedValue(pairingSession)
    vi.mocked(getCompanionPairingStatus).mockResolvedValue(null)
    vi.mocked(listCompanionDevices).mockResolvedValue([])
    vi.mocked(cancelCompanionPairing).mockResolvedValue()
    vi.mocked(approveCompanionPairing).mockResolvedValue()
    vi.mocked(rejectCompanionPairing).mockResolvedValue()
    vi.mocked(revokeCompanionDevice).mockResolvedValue()
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

  it('starts and cancels a short-lived QR pairing session', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(runningStatus)
    render(SettingsCompanionCard)

    await fireEvent.click(await screen.findByRole('button', { name: 'Pair a phone' }))

    expect(startCompanionPairing).toHaveBeenCalledOnce()
    const qr = await screen.findByRole('img', { name: 'Companion pairing QR code' })
    expect(qr.getAttribute('src')).toBe('data:image/png;base64,pairing-qr')
    expect(screen.getByText((content) => content.startsWith('Expires '))).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel pairing' }))
    expect(cancelCompanionPairing).toHaveBeenCalledWith('pairing-session-1')
    expect(screen.queryByRole('img', { name: 'Companion pairing QR code' })).toBeNull()
  })

  it('shows a recognizable pending device and approves it from the trusted desktop UI', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(runningStatus)
    vi.mocked(getCompanionPairingStatus).mockResolvedValue({
      ...pairingSession,
      pendingRequest: {
        requestId: 'request-1',
        deviceName: "Koen's iPhone",
        platform: 'ios',
      },
    })
    render(SettingsCompanionCard)

    expect(await screen.findByText("Koen's iPhone")).toBeTruthy()
    expect(screen.getByText(/iOS · Awaiting/)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Approve Koen\'s iPhone' }))

    expect(approveCompanionPairing).toHaveBeenCalledWith('request-1')
    expect(await screen.findByText(/Device approved/i)).toBeTruthy()
    expect(screen.getByText('Approved — waiting for phone')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pair a phone' })).toBeNull()
  })

  it('rejects a pending device without approving it', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(runningStatus)
    vi.mocked(getCompanionPairingStatus).mockResolvedValue({
      ...pairingSession,
      pendingRequest: {
        requestId: 'request-2',
        deviceName: 'Pixel 9',
        platform: 'android',
      },
    })
    render(SettingsCompanionCard)

    await fireEvent.click(await screen.findByRole('button', { name: 'Reject Pixel 9' }))

    expect(rejectCompanionPairing).toHaveBeenCalledWith('request-2')
    expect(approveCompanionPairing).not.toHaveBeenCalled()
    expect(await screen.findByText(/Device rejected/i)).toBeTruthy()
  })

  it('lists and revokes an approved device even while the gateway is disabled', async () => {
    vi.mocked(listCompanionDevices).mockResolvedValue([
      {
        deviceId: 'device-1',
        deviceName: "Koen's iPhone",
        platform: 'ios',
        pairedAt: '2026-07-30T12:00:00Z',
        lastSeenAt: null,
        revokedAt: null,
      },
    ])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(SettingsCompanionCard)

    await fireEvent.click(await screen.findByRole('button', { name: 'Revoke Koen\'s iPhone' }))

    expect(confirm).toHaveBeenCalled()
    expect(revokeCompanionDevice).toHaveBeenCalledWith('device-1')
    confirm.mockRestore()
  })

  it('disables a running gateway and reports the resulting state', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(runningStatus)
    vi.mocked(setCompanionGatewayEnabled).mockResolvedValue(disabledStatus)
    render(SettingsCompanionCard)

    await fireEvent.click(await screen.findByRole('button', { name: 'Disable Companion Gateway' }))

    expect(setCompanionGatewayEnabled).toHaveBeenCalledWith(false)
    expect(await screen.findByText('Disabled')).toBeTruthy()
  })

  it('retries a failed pairing status request from the Retry action', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(runningStatus)
    vi.mocked(getCompanionPairingStatus)
      .mockRejectedValueOnce(new Error('Pairing status unavailable'))
      .mockResolvedValue(null)
    render(SettingsCompanionCard)

    await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(getCompanionGatewayStatus).toHaveBeenCalledTimes(2))
    expect(getCompanionPairingStatus).toHaveBeenCalledTimes(2)
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
