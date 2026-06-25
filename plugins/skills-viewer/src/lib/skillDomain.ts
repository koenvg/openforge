export interface SkillInfo {
  name: string
  description: string | null
  agent: string | null
  template: string | null
  level: 'project' | 'user'
  source_dir: string
  source_path: string
  file_name: string | null
}

export interface SkillIdentity {
  level: SkillInfo['level']
  source_dir: string
  source_path: string
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
  const skillFilePath = skill.file_name ? `${sourcePath}/${skill.file_name}` : `${sourcePath}/${skill.source_path}/SKILL.md`
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

export interface SkillFrontmatterMetadata {
  name: string | null
  description: string | null
}

export function parseSkillFrontmatter(content: string): SkillFrontmatterMetadata {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return { name: null, description: null }

  const afterFirst = trimmed.slice(3)
  const endIndex = afterFirst.indexOf('\n---')
  if (endIndex < 0) return { name: null, description: null }

  const frontmatter = afterFirst.slice(0, endIndex)
  let name: string | null = null
  let description = ''
  let inDescription = false

  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmedLine = line.trim()
    if (trimmedLine.startsWith('name:')) {
      const value = trimmedLine.slice('name:'.length).trim().replace(/^["']|["']$/g, '')
      name = value || null
      inDescription = false
      continue
    }

    if (trimmedLine.startsWith('description:')) {
      const value = trimmedLine.slice('description:'.length).trim().replace(/^["']|["']$/g, '')
      if (value === '|' || value === '>' || value === '') {
        inDescription = true
      } else {
        description = value
        inDescription = false
      }
      continue
    }

    if (inDescription) {
      if (trimmedLine && (line.startsWith(' ') || line.startsWith('\t'))) {
        description = description ? `${description} ${trimmedLine}` : trimmedLine
      } else {
        inDescription = false
      }
    }
  }

  return { name, description: description || null }
}

export function stripSkillFrontmatter(content: string): string {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return content

  const delimiterMatch = /\r?\n---(?:\r?\n|$)/.exec(content.slice(3))
  if (!delimiterMatch) return content

  const bodyStart = 3 + delimiterMatch.index + delimiterMatch[0].length
  return content.slice(bodyStart)
}

export function getSkillIdentity(skill: SkillInfo): SkillIdentity {
  return {
    level: skill.level,
    source_dir: skill.source_dir,
    source_path: skill.source_path,
    file_name: skill.file_name,
  }
}

export function isSameSkillIdentity(skill: SkillInfo, identity: SkillIdentity | null): boolean {
  return identity !== null &&
    skill.level === identity.level &&
    skill.source_dir === identity.source_dir &&
    skill.source_path === identity.source_path &&
    skill.file_name === identity.file_name
}

export function getPreferredSkillIdentity(skills: SkillInfo[], currentIdentity: SkillIdentity | null): SkillIdentity | null {
  const currentSkill = skills.find((skill) => isSameSkillIdentity(skill, currentIdentity))
  if (currentSkill) return currentIdentity

  const projectSkill = skills.find((skill) => skill.level === 'project')
  return projectSkill ? getSkillIdentity(projectSkill) : (skills[0] ? getSkillIdentity(skills[0]) : null)
}
