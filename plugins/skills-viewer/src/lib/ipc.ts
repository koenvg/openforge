import { getPluginContext } from '../pluginContext'
import type { SkillInfo } from './types'

export async function listOpenCodeSkills(projectId: string): Promise<SkillInfo[]> {
  return getPluginContext().invokeHost('listOpenCodeSkills', { projectId }) as Promise<SkillInfo[]>
}

export async function saveSkillContent(
  projectId: string,
  name: string,
  level: SkillInfo['level'],
  sourceDir: string,
  content: string,
): Promise<void> {
  await getPluginContext().invokeHost('saveSkillContent', { projectId, name, level, sourceDir, content })
}

export async function openUrl(url: string): Promise<void> {
  await getPluginContext().invokeHost('openUrl', { url })
}
