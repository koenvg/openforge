import type { PoolEntry } from '@openforge-app/terminal-runtime'
import type { TerminalE2eGateCoordinator } from './terminalE2eGates'

let coordinator: TerminalE2eGateCoordinator | null = null
const acquiredEntriesForDiagnostics = new Map<string, PoolEntry>()

export function configureTerminalE2eRuntime(value: TerminalE2eGateCoordinator | null): void {
  if (coordinator !== value) acquiredEntriesForDiagnostics.clear()
  coordinator = value
}

export function getTerminalE2eGateCoordinator(): TerminalE2eGateCoordinator | null {
  return coordinator
}

export function getAcquiredTerminalForE2eDiagnostics(shellSessionKey: string): PoolEntry | null {
  return acquiredEntriesForDiagnostics.get(shellSessionKey) ?? null
}

export function checkpointTerminalAcquisition(entry: PoolEntry): Promise<void> | undefined {
  if (!coordinator) return undefined
  acquiredEntriesForDiagnostics.set(entry.shellSessionKey, entry)
  return coordinator.checkpoint('acquisition', entry.shellSessionKey, {
    attachmentGeneration: entry.attachmentGeneration,
    ptyInstanceId: entry.currentPtyInstance,
  })
}

export function checkpointTerminalAuthorityRead(
  shellSessionKey: string,
  details: { ptyInstanceId: number | null; watermark: number | null },
): Promise<void> | undefined {
  return coordinator?.checkpoint('authoritative-read', shellSessionKey, details)
}
