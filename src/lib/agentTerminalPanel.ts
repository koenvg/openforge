import { writePty } from './ipc'
import { getShellLifecycleState, restorePtyInstance } from './terminalPool'

export function hydrateAgentTerminalPtyInstance(taskId: string, currentPtyInstance: number): void {
  void restorePtyInstance(taskId, currentPtyInstance)
}

export async function writeAgentTerminalTranscription(taskId: string, text: string, logPrefix: string): Promise<void> {
  if (!getShellLifecycleState(taskId).ptyActive) return

  await writePty(taskId, text).catch(e => {
    console.error(`[${logPrefix}] transcription write failed:`, e)
  })
}
