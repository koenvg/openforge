import type { BridgeResponseLike, ElectronInvokeDeps } from './backendBridge.js'
import { SIDECAR_BACKED_COMMANDS } from './generatedRustSidecarCommands.js'

export function isSidecarBackedCommand(command: string): boolean {
  return SIDECAR_BACKED_COMMANDS.has(command)
}

async function responseError(response: BridgeResponseLike): Promise<Error> {
  const detail = response.text ? await response.text() : `HTTP ${response.status ?? 'error'}`
  return new Error(`Rust sidecar command failed: ${detail}`)
}

export async function forwardToSidecar(command: string, payload: unknown, deps: ElectronInvokeDeps): Promise<unknown> {
  if (!deps.sidecarConfig) {
    throw new Error('Rust sidecar is not available')
  }

  const response = await deps.fetch(`http://${deps.sidecarConfig.host}:${deps.sidecarConfig.port}/app/invoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.sidecarConfig.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command, payload: payload ?? null }),
  })

  if (!response.ok) {
    throw await responseError(response)
  }

  const body = await response.json()
  return typeof body === 'object' && body !== null && 'value' in body
    ? (body as { value: unknown }).value
    : body
}
