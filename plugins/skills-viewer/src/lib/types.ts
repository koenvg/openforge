export interface SkillInfo {
  name: string
  description: string | null
  agent: string | null
  template: string | null
  level: 'project' | 'user'
  source_dir: string
}

export interface SkillIdentity {
  name: string
  level: SkillInfo['level']
  source_dir: string
}

export function getSkillIdentity(skill: SkillInfo): SkillIdentity {
  return { name: skill.name, level: skill.level, source_dir: skill.source_dir }
}

export function isSameSkillIdentity(skill: SkillInfo, identity: SkillIdentity | null): boolean {
  return identity !== null && skill.name === identity.name && skill.level === identity.level && skill.source_dir === identity.source_dir
}
