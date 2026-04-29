import { getPluginContext } from '../pluginContext'
import type { FileContent, FileEntry } from '@openforge/plugin-sdk/domain'

export async function fsReadDir(projectId: string, dirPath: string | null): Promise<FileEntry[]> {
  return getPluginContext().invokeHost('fsReadDir', { projectId, dirPath }) as Promise<FileEntry[]>
}

export async function fsReadFile(projectId: string, filePath: string): Promise<FileContent> {
  return getPluginContext().invokeHost('fsReadFile', { projectId, filePath }) as Promise<FileContent>
}

export async function openUrl(url: string): Promise<void> {
  await getPluginContext().invokeHost('openUrl', { url })
}
