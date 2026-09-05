import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approveCompanionPairing,
  cancelCompanionPairing,
  getCompanionGatewayStatus,
  getCompanionPairingStatus,
  listCompanionDevices,
  rejectCompanionPairing,
  removeCompanionDevice,
  revokeCompanionDevice,
  resetCompanionHostIdentity,
  setCompanionGatewayEnabled,
  setCompanionTailscaleHostname,
  startCompanionPairing,
} from '../../lib/ipc'
import SettingsCompanionCard from './SettingsCompanionCard.svelte'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,pairing-qr') },
}))

vi.mock('../../lib/ipc', () => ({
  getCompanionGatewayStatus: vi.fn(),
  setCompanionGatewayEnabled: vi.fn(),
  setCompanionTailscaleHostname: vi.fn(),
  startCompanionPairing: vi.fn(),
  getCompanionPairingStatus: vi.fn(),
  cancelCompanionPairing: vi.fn(),
  approveCompanionPairing: vi.fn(),
  rejectCompanionPairing: vi.fn(),
  listCompanionDevices: vi.fn(),
  revokeCompanionDevice: vi.fn(),
  removeCompanionDevice: vi.fn(),
  resetCompanionHostIdentity: vi.fn(),
}))

const disabledStatus = {
  enabled: false,
  phase: 'disabled' as const,
  hostId: null,
  certificateFingerprint: null,
  endpoints: [],
  tailscale: {
    detectedHostname: null,
    configuredHostname: null,
    effectiveHostname: null,
  },
  error: null,
}

const runningStatus = {
  enabled: true,
  phase: 'running' as const,
  hostId: 'desktop-host-1',
  certificateFingerprint: 'AA:BB:CC',
  endpoints: [
    { kind: 'lan' as const, url: 'https://192.168.1.20:17424' },
    { kind: 'tailscale' as const, url: 'https://forge-mac.example.ts.net:17424' },
  ],
  tailscale: {
    detectedHostname: 'forge-mac.example.ts.net',
    configuredHostname: null,
    effectiveHostname: 'forge-mac.example.ts.net',
  },
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
    vi.mocked(setCompanionTailscaleHostname).mockImplementation(async (hostname) => ({
      ...runningStatus,
      tailscale: {
        ...runningStatus.tailscale,
        configuredHostname: hostname,
        effectiveHostname: hostname,
      },
      endpoints: [
        runningStatus.endpoints[0],
        { kind: 'tailscale', url: `https://${hostname}:17424` },
      ],
    }))
    vi.mocked(startCompanionPairing).mockResolvedValue(pairingSession)
    vi.mocked(getCompanionPairingStatus).mockResolvedValue(null)
    vi.mocked(listCompanionDevices).mockResolvedValue([])
    vi.mocked(cancelCompanionPairing).mockResolvedValue()
    vi.mocked(approveCompanionPairing).mockResolvedValue()
    vi.mocked(rejectCompanionPairing).mockResolvedValue()
    vi.mocked(revokeCompanionDevice).mockResolvedValue()
    vi.mocked(removeCompanionDevice).mockResolvedValue()
    vi.mocked(resetCompanionHostIdentity).mockResolvedValue({
      ...runningStatus,
      hostId: 'desktop-host-2',
      certificateFingerprint: 'DD:EE:FF',
    })
  })

  it('shows that Companion connectivity is off by default and requires OpenForge to remain running', async () => {
    render(SettingsCompanionCard)

    expect(await screen.findByText('Disabled')).toBeTruthy()
    expect(screen.getByText(/OpenForge must remain running/i)).toBeTruthy()
    expect(screen.getByText(/interactive Agent terminal access/i)).toBeTruthy()
    expect(screen.getByText(/authority remains active while this Mac is locked/i)).toBeTruthy()
    expect(screen.getByText(/gateway is disabled, the device is revoked, or Companion identity is reset/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enable Companion Gateway' })).toBeTruthy()
  })

  it('enables through the typed IPC boundary and renders health and offered endpoints', async () => {
    render(SettingsCompanionCard)

    await fireEvent.click(await screen.findByRole('button', { name: 'Enable Companion Gateway' }))

    expect(setCompanionGatewayEnabled).toHaveBeenCalledWith(true)
    expect(await screen.findByText('Running')).toBeTruthy()
    expect(screen.getByText('https://192.168.1.20:17424')).toBeTruthy()
    expect(screen.getByText('https://forge-mac.example.ts.net:17424')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Disable Companion Gateway' })).toBeTruthy()
  })

  it('offers the detected MagicDNS hostname for confirmation and saves a correction', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(runningStatus)
    render(SettingsCompanionCard)

    const hostname = await screen.findByRole('textbox', { name: 'Tailscale MagicDNS hostname' })
    expect((hostname as HTMLInputElement).value).toBe('forge-mac.example.ts.net')
    await fireEvent.input(hostname, { target: { value: 'forge-mac-corrected.example.ts.net' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save Tailscale hostname' }))

    expect(setCompanionTailscaleHostname).toHaveBeenCalledWith('forge-mac-corrected.example.ts.net')
    expect(await screen.findByText(/Tailscale hostname saved/i)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Success')
    expect(screen.getByRole('status').textContent).toContain('Tailscale hostname saved')
    expect(screen.getByText(/OpenForge operates no central server/i)).toBeTruthy()
  })

  it('explains that pairing cannot include the hostname until Tailscale is offered', async () => {
    const noTailscaleEndpoint = {
      ...runningStatus,
      endpoints: [runningStatus.endpoints[0]],
      tailscale: {
        detectedHostname: null,
        configuredHostname: null,
        effectiveHostname: null,
      },
    }
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(noTailscaleEndpoint)
    vi.mocked(setCompanionTailscaleHostname).mockResolvedValue({
      ...noTailscaleEndpoint,
      tailscale: {
        ...noTailscaleEndpoint.tailscale,
        configuredHostname: 'forge-mac.example.ts.net',
        effectiveHostname: 'forge-mac.example.ts.net',
      },
    })
    render(SettingsCompanionCard)

    const hostname = await screen.findByRole('textbox', { name: 'Tailscale MagicDNS hostname' })
    await fireEvent.input(hostname, { target: { value: 'forge-mac.example.ts.net' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save Tailscale hostname' }))

    expect(await screen.findByText(/Connect Tailscale on this Mac and re-enable the gateway before pairing/i)).toBeTruthy()
    expect(screen.queryByText(/New pairing codes will include this endpoint/i)).toBeNull()
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
    expect(screen.getByText(/Approval grants this phone authority.*Create backlog Tasks.*Start backlog Tasks.*Delete or Complete Tasks.*type into running Agent terminals/i)).toBeTruthy()
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
    expect(screen.getByText('Device ID')).toBeTruthy()
    expect(screen.getByText('device-1')).toBeTruthy()
    expect(screen.getByText('Last seen')).toBeTruthy()
    expect(screen.getByText(/Paired devices can Create backlog Tasks.*Start backlog Tasks.*Delete or Complete Tasks.*type into running Agent terminals/i)).toBeTruthy()
    expect(screen.getByText(/Existing paired devices inherit this fixed authority without reapproval/i)).toBeTruthy()
    expect(screen.getByText('never')).toBeTruthy()
    confirm.mockRestore()
  })

  it('permanently removes only a revoked device after confirmation while the gateway is disabled', async () => {
    const activeDevice = {
      deviceId: 'active-device',
      deviceName: 'Active Pixel',
      platform: 'android' as const,
      pairedAt: '2026-07-30T12:00:00Z',
      lastSeenAt: null,
      revokedAt: null,
    }
    const revokedDevice = {
      deviceId: 'revoked-device',
      deviceName: 'Revoked Pixel',
      platform: 'android' as const,
      pairedAt: '2026-07-29T12:00:00Z',
      lastSeenAt: '2026-07-30T12:30:00Z',
      revokedAt: '2026-07-30T13:00:00Z',
    }
    vi.mocked(listCompanionDevices)
      .mockResolvedValueOnce([activeDevice, revokedDevice])
      .mockResolvedValueOnce([activeDevice])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(SettingsCompanionCard)

    expect(await screen.findByRole('button', { name: 'Remove Revoked Pixel' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove Active Pixel' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Revoked Pixel' }))

    expect(confirm).toHaveBeenCalledWith(
      'Remove Revoked Pixel? This permanently deletes its pairing record.',
    )
    expect(removeCompanionDevice).toHaveBeenCalledWith('revoked-device')
    await waitFor(() => expect(screen.queryByText('revoked-device')).toBeNull())
    expect(screen.getByText('active-device')).toBeTruthy()
    expect(await screen.findByText('Removed device: Revoked Pixel')).toBeTruthy()
    confirm.mockRestore()
  })

  it('reports a completed removal when the authoritative device refresh fails', async () => {
    vi.mocked(listCompanionDevices)
      .mockResolvedValueOnce([
        {
          deviceId: 'revoked-device',
          deviceName: 'Revoked Pixel',
          platform: 'android',
          pairedAt: '2026-07-29T12:00:00Z',
          lastSeenAt: null,
          revokedAt: '2026-07-30T13:00:00Z',
        },
      ])
      .mockRejectedValueOnce(new Error('device list unavailable'))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(SettingsCompanionCard)

    await fireEvent.click(await screen.findByRole('button', { name: 'Remove Revoked Pixel' }))

    expect(removeCompanionDevice).toHaveBeenCalledWith('revoked-device')
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /device was removed.*paired devices could not be refreshed.*device list unavailable/i,
    )
    expect(screen.queryByText('Removed device: Revoked Pixel')).toBeNull()
    confirm.mockRestore()
  })

  it('keeps a revoked device when permanent removal is declined', async () => {
    vi.mocked(listCompanionDevices).mockResolvedValue([
      {
        deviceId: 'revoked-device',
        deviceName: 'Revoked Pixel',
        platform: 'android',
        pairedAt: '2026-07-29T12:00:00Z',
        lastSeenAt: null,
        revokedAt: '2026-07-30T13:00:00Z',
      },
    ])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(SettingsCompanionCard)

    await fireEvent.click(await screen.findByRole('button', { name: 'Remove Revoked Pixel' }))

    expect(removeCompanionDevice).not.toHaveBeenCalled()
    expect(screen.getByText('revoked-device')).toBeTruthy()
    confirm.mockRestore()
  })

  it('resets host identity only after a separate destructive confirmation', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(runningStatus)
    vi.mocked(listCompanionDevices).mockResolvedValue([
      {
        deviceId: 'device-1',
        deviceName: "Koen's iPhone",
        platform: 'ios',
        pairedAt: '2026-07-30T12:00:00Z',
        lastSeenAt: '2026-07-30T12:30:00Z',
        revokedAt: null,
      },
    ])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(SettingsCompanionCard)

    await fireEvent.click(
      await screen.findByRole('button', { name: 'Reset Companion identity' }),
    )

    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/all paired devices.*pair again/i),
    )
    expect(resetCompanionHostIdentity).toHaveBeenCalledOnce()
    expect(await screen.findByText(/Companion identity reset/i)).toBeTruthy()
    expect(screen.getByText('desktop-host-2')).toBeTruthy()
    confirm.mockRestore()
  })

  it('does not reset identity when destructive confirmation is declined', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(runningStatus)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(SettingsCompanionCard)

    await fireEvent.click(
      await screen.findByRole('button', { name: 'Reset Companion identity' }),
    )

    expect(resetCompanionHostIdentity).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('keeps reset success visible when the device refresh fails afterward', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(runningStatus)
    vi.mocked(listCompanionDevices)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('device list unavailable'))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(SettingsCompanionCard)

    await fireEvent.click(
      await screen.findByRole('button', { name: 'Reset Companion identity' }),
    )

    expect(resetCompanionHostIdentity).toHaveBeenCalledOnce()
    expect(await screen.findByText(/Companion identity reset/i)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/reset succeeded.*could not be refreshed/i)
    confirm.mockRestore()
  })

  it('refreshes authoritative trust state after a reset operation fails', async () => {
    vi.mocked(getCompanionGatewayStatus).mockResolvedValue(runningStatus)
    vi.mocked(resetCompanionHostIdentity).mockRejectedValue(new Error('identity save failed'))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(SettingsCompanionCard)

    await fireEvent.click(
      await screen.findByRole('button', { name: 'Reset Companion identity' }),
    )

    expect((await screen.findByRole('alert')).textContent).toContain('identity save failed')
    expect(screen.getByRole('alert').textContent).toContain('Error')
    expect(getCompanionGatewayStatus).toHaveBeenCalledTimes(2)
    expect(listCompanionDevices).toHaveBeenCalledTimes(2)
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

    expect((await screen.findByRole('alert')).textContent).toContain('Error')
    expect(screen.getByText('No reachable private network interface is available')).toBeTruthy()
  })
})
