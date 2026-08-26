import { invokeDesktopCommand as invoke } from '../desktopIpc'
import type { CompanionGatewayStatus, CompanionPairedDevice, CompanionPairingSession } from '../types'

export async function getCompanionGatewayStatus(): Promise<CompanionGatewayStatus> {
  return invoke<CompanionGatewayStatus>("get_companion_gateway_status");
}

export async function setCompanionGatewayEnabled(enabled: boolean): Promise<CompanionGatewayStatus> {
  return invoke<CompanionGatewayStatus>("set_companion_gateway_enabled", { enabled });
}

export async function setCompanionTailscaleHostname(hostname: string): Promise<CompanionGatewayStatus> {
  return invoke<CompanionGatewayStatus>('set_companion_tailscale_hostname', { hostname })
}

export async function startCompanionPairing(): Promise<CompanionPairingSession> {
  return invoke<CompanionPairingSession>('start_companion_pairing')
}

export async function getCompanionPairingStatus(): Promise<CompanionPairingSession | null> {
  return invoke<CompanionPairingSession | null>('get_companion_pairing_status')
}

export async function cancelCompanionPairing(sessionId: string): Promise<void> {
  return invoke('cancel_companion_pairing', { sessionId })
}

export async function approveCompanionPairing(requestId: string): Promise<void> {
  return invoke('approve_companion_pairing', { requestId })
}

export async function rejectCompanionPairing(requestId: string): Promise<void> {
  return invoke('reject_companion_pairing', { requestId })
}

export async function listCompanionDevices(): Promise<CompanionPairedDevice[]> {
  return invoke<CompanionPairedDevice[]>('list_companion_devices')
}

export async function revokeCompanionDevice(deviceId: string): Promise<void> {
  return invoke('revoke_companion_device', { deviceId })
}

export async function removeCompanionDevice(deviceId: string): Promise<void> {
  return invoke('remove_companion_device', { deviceId })
}

export async function resetCompanionHostIdentity(): Promise<CompanionGatewayStatus> {
  return invoke<CompanionGatewayStatus>('reset_companion_host_identity')
}
