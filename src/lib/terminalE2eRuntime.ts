import type { TerminalSession, TerminalSessionDiagnostics } from '@openforge-app/terminal-runtime'
import type { TerminalE2eGateCoordinator } from './terminalE2eGates'

let coordinator: TerminalE2eGateCoordinator | null = null
const acquiredDiagnostics = new Map<string, () => TerminalSessionDiagnostics>()

export function configureTerminalE2eRuntime(value: TerminalE2eGateCoordinator | null): void {
  if (coordinator !== value) acquiredDiagnostics.clear()
  coordinator = value
}

export function getTerminalE2eGateCoordinator(): TerminalE2eGateCoordinator | null {
  return coordinator
}

export function getAcquiredTerminalForE2eDiagnostics(
  shellSessionKey: string,
): TerminalSessionDiagnostics | null {
  return acquiredDiagnostics.get(shellSessionKey)?.() ?? null
}

export function checkpointTerminalAcquisition(
  session: TerminalSession,
  getDiagnostics: () => TerminalSessionDiagnostics,
): Promise<void> | undefined {
  if (!coordinator) return undefined
  acquiredDiagnostics.set(session.shellSessionKey, getDiagnostics)
  const diagnostics = getDiagnostics()
  return coordinator.checkpoint('acquisition', session.shellSessionKey, {
    attachmentGeneration: diagnostics.view.attachmentGeneration,
    ptyInstanceId: diagnostics.lifecycle.currentPtyInstance,
  })
}

export function checkpointTerminalAuthorityRead(
  shellSessionKey: string,
  details: { ptyInstanceId: number | null; watermark: number | null },
): Promise<void> | undefined {
  return coordinator?.checkpoint('authoritative-read', shellSessionKey, details)
}
