import { invokeDesktopCommand as invoke } from '../desktopIpc'
import type { ProcessMemoryHistorySnapshot } from '../types'

export async function getProcessMemoryHistory(): Promise<ProcessMemoryHistorySnapshot> {
  return invoke<ProcessMemoryHistorySnapshot>('get_process_memory_history')
}

export async function setProcessMemoryHistoryEnabled(
  enabled: boolean,
): Promise<ProcessMemoryHistorySnapshot> {
  return invoke<ProcessMemoryHistorySnapshot>('set_process_memory_history_enabled', { enabled })
}
