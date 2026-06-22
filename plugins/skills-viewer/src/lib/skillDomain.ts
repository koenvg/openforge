export interface SkillInfo {
  name: string
  description: string | null
  agent: string | null
  template: string | null
  level: 'project' | 'user'
  source_dir: string
  file_name: string | null
}

export interface SkillIdentity {
  name: string
  level: SkillInfo['level']
  source_dir: string
  file_name: string | null
}

export const SKILL_SOURCE_DIRS = ['.agents', '.claude', '.opencode', '.pi'] as const

export type SkillSourceDir = typeof SKILL_SOURCE_DIRS[number]

export interface SkillSourceGroup {
  source: string
  skills: SkillInfo[]
}

export function getSkillSourcePath(source: string, level: SkillInfo['level']): string {
  if (source === '.pi' && level === 'user') return '.pi/agent/skills'
  return `${source}/skills`
}

export function getSkillLocationLabel(skill: SkillInfo): string {
  const sourcePath = getSkillSourcePath(skill.source_dir, skill.level)
  const skillFilePath = skill.file_name ? `${sourcePath}/${skill.file_name}` : `${sourcePath}/${skill.name}/SKILL.md`
  return skill.level === 'user' ? `~/${skillFilePath}` : skillFilePath
}

export function groupSkillsBySource(skills: SkillInfo[]): SkillSourceGroup[] {
  const groups: SkillSourceGroup[] = []
  for (const source of SKILL_SOURCE_DIRS) {
    const matching = skills.filter((skill) => skill.source_dir === source)
    if (matching.length > 0) {
      groups.push({ source, skills: matching })
    }
  }

  const known = new Set<string>(SKILL_SOURCE_DIRS)
  const other = skills.filter((skill) => !known.has(skill.source_dir))
  if (other.length > 0) {
    groups.push({ source: 'other', skills: other })
  }

  return groups
}

export function getSkillIdentity(skill: SkillInfo): SkillIdentity {
  return {
    name: skill.name,
    level: skill.level,
    source_dir: skill.source_dir,
    file_name: skill.file_name,
  }
}

export function isSameSkillIdentity(skill: SkillInfo, identity: SkillIdentity | null): boolean {
  return identity !== null &&
    skill.name === identity.name &&
    skill.level === identity.level &&
    skill.source_dir === identity.source_dir &&
    skill.file_name === identity.file_name
}

export function getPreferredSkillIdentity(skills: SkillInfo[], currentIdentity: SkillIdentity | null): SkillIdentity | null {
  const currentSkill = skills.find((skill) => isSameSkillIdentity(skill, currentIdentity))
  if (currentSkill) return currentIdentity

  const projectSkill = skills.find((skill) => skill.level === 'project')
  return projectSkill ? getSkillIdentity(projectSkill) : (skills[0] ? getSkillIdentity(skills[0]) : null)
}
