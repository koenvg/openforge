import { getPluginContext } from '../pluginContext'
import type { TaskWorkspaceInfo } from './types'

export async function spawnShellPty(taskId: string, cwd: string, cols: number, rows: number, terminalIndex: number): Promise<number> {
  return getPluginContext().invokeHost('spawnShellPty', { taskId, cwd, cols, rows, terminalIndex }) as Promise<number>
}

export async function writePty(taskId: string, data: string): Promise<void> {
  await getPluginContext().invokeHost('writePty', { taskId, data })
}

export async function resizePty(taskId: string, cols: number, rows: number): Promise<void> {
  await getPluginContext().invokeHost('resizePty', { taskId, cols, rows })
}

export async function killPty(taskId: string): Promise<void> {
  await getPluginContext().invokeHost('killPty', { taskId })
}

export async function getPtyBuffer(taskId: string): Promise<string | null> {
  return getPluginContext().invokeHost('getPtyBuffer', { taskId }) as Promise<string | null>
}

export async function getTaskWorkspace(taskId: string): Promise<TaskWorkspaceInfo | null> {
  return getPluginContext().invokeHost('getTaskWorkspace', { taskId }) as Promise<TaskWorkspaceInfo | null>
}

export async function openUrl(url: string): Promise<void> {
  await getPluginContext().invokeHost('openUrl', { url })
}

export async function getConfig(key: string): Promise<string | null> {
  return getPluginContext().invokeHost('getConfig', { key }) as Promise<string | null>
}

export async function setConfig(key: string, value: string): Promise<void> {
  await getPluginContext().invokeHost('setConfig', { key, value })
}
