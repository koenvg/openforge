import { parsePtySessionKey, type TerminalResizeAttachment } from '@openforge-app/terminal-runtime'
import type { RestartTerminalController, RestartTerminalFence, RestartTerminalInventory } from '../electron/restartWorkspace'
import type { DesktopPtyBufferState } from './desktopTerminalTransport'

interface RestartTerminalPort {
  getPtyBuffer(key: string, fence?: RestartTerminalFence): Promise<DesktopPtyBufferState>
  writePty(key: string, data: string | Uint8Array, fence?: RestartTerminalFence): Promise<void>
  resizePty(key: string, cols: number, rows: number, fence?: RestartTerminalFence, attachment?: TerminalResizeAttachment): Promise<void>
  inventory(): Promise<RestartTerminalInventory>
  killPty(key: string, fence?: RestartTerminalFence): Promise<void>
}

/** Ephemeral daemon authority, deliberately separate from saved workspace metadata. */
export function createRestartTerminalControl(port: RestartTerminalPort) {
  let controller: RestartTerminalController | null = null
  let generation = 0
  let available = true
  let sessions = new Map<string, { instanceId: number; isLive: boolean }>()
  const reconciled = new Set<string>()

  function suspend(): void {
    if (!controller) return
    generation += 1
    available = false
    reconciled.clear()
  }

  function reconcile(inventory: RestartTerminalInventory): void {
    generation += 1
    controller = { ...inventory.controller }
    sessions = new Map(inventory.sessions.map(session => [session.key, { instanceId: session.instanceId, isLive: session.isLive }]))
    reconciled.clear()
    available = true
  }

  function fence(key: string, requireReconciled: boolean): RestartTerminalFence | undefined {
    if (!controller || parsePtySessionKey(key).kind !== 'indexed-shell') return undefined
    const session = sessions.get(key)
    if (!available || !session || (requireReconciled && (!reconciled.has(key) || !session.isLive))) {
      throw new Error('Terminal identity reconciliation is required before control is available')
    }
    return { controller: { ...controller }, instanceId: session.instanceId }
  }

  async function getPtyBuffer(key: string): Promise<DesktopPtyBufferState> {
    if (!controller || parsePtySessionKey(key).kind !== 'indexed-shell') return port.getPtyBuffer(key)
    if (!available) throw new Error('Terminal identity reconciliation is required')
    const epoch = generation
    const inventory = await port.inventory()
    if (epoch !== generation) throw new Error('Stale terminal inventory')
    if (inventory.controller.installation !== controller.installation
      || inventory.controller.lifetime !== controller.lifetime
      || inventory.controller.generation !== controller.generation) {
      suspend()
      throw new Error('Terminal controller changed; reconciliation is required')
    }
    const session = inventory.sessions.find(session => session.key === key)
    const previous = sessions.get(key)
    if (!session) {
      reconciled.delete(key)
      return { buffer: null, snapshot: null, instanceId: null, isLive: false }
    }
    if (previous && previous.instanceId > session.instanceId) throw new Error('Stale PTY inventory')
    if (previous?.instanceId !== session.instanceId || !session.isLive) reconciled.delete(key)
    sessions.set(key, { instanceId: session.instanceId, isLive: session.isLive })
    const requestedGeneration = generation
    const identity = fence(key, false)
    const replay = await port.getPtyBuffer(key, identity)
    if (requestedGeneration !== generation) throw new Error('Stale terminal replay after controller replacement')
    if (identity && (replay.instanceId !== identity.instanceId || sessions.get(key)?.instanceId !== identity.instanceId)) throw new Error('Stale PTY identity in terminal replay')
    if (controller) {
      reconciled.add(key)
      const session = sessions.get(key)
      if (session) session.isLive = replay.isLive
    }
    return replay
  }

  return {
    reconcile,
    suspend,
    getPtyBuffer,
    async reconnect(): Promise<void> {
      if (!controller) return
      suspend()
      const pendingGeneration = generation
      const inventory = await port.inventory()
      if (pendingGeneration === generation) reconcile(inventory)
    },
    async killPty(key: string): Promise<void> {
      if (!controller || parsePtySessionKey(key).kind !== 'indexed-shell') return port.killPty(key)
      if (!available) throw new Error('Terminal identity reconciliation is required')
      if (!sessions.has(key)) return
      const identity = fence(key, false)
      reconciled.delete(key)
      await port.killPty(key, identity)
    },
    async writePty(key: string, data: string | Uint8Array): Promise<void> {
      const identity = fence(key, true)
      if (identity) await port.writePty(key, data, identity)
      else await port.writePty(key, data)
    },
    async resizePty(key: string, cols: number, rows: number, attachment?: TerminalResizeAttachment): Promise<void> {
      const identity = fence(key, true)
      if (identity && attachment) await port.resizePty(key, cols, rows, identity, attachment)
      else if (identity) await port.resizePty(key, cols, rows, identity)
      else await port.resizePty(key, cols, rows)
    },
  }
}
