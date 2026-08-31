import { writePty } from './ipc'
import { agentTerminalSessions } from './terminalSessionService'

export function hydrateAgentTerminalPtyInstance(taskId: string, currentPtyInstance: number): void {
  void agentTerminalSessions.restorePtyInstance(taskId, currentPtyInstance)
}

export async function writeAgentTerminalTranscription(taskId: string, text: string, logPrefix: string): Promise<void> {
  if (!agentTerminalSessions.getShellLifecycleState(taskId).ptyActive) return

  await writePty(taskId, text).catch(e => {
    console.error(`[${logPrefix}] transcription write failed:`, e)
  })
}
