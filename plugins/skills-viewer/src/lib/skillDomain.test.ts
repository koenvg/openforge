import { describe, expect, it } from 'vitest'
import { getPreferredSkillIdentity, getSkillIdentity, getSkillSourcePath, groupSkillsBySource, type SkillInfo } from './skillDomain'

function makeSkill(name: string, source_dir: string, level: SkillInfo['level'] = 'project'): SkillInfo {
  return { name, source_dir, level, description: null, agent: null, template: null, file_name: null }
}

describe('skills-viewer skill domain helpers', () => {
  it('groups skills by known provider source order and appends unknown sources to other', () => {
    const skills = [
      makeSkill('custom', '.custom'),
      makeSkill('pi', '.pi'),
      makeSkill('agents', '.agents'),
      makeSkill('other-custom', '.another'),
      makeSkill('opencode', '.opencode'),
    ]

    expect(groupSkillsBySource(skills)).toEqual([
      { source: '.agents', skills: [skills[2]] },
      { source: '.opencode', skills: [skills[4]] },
      { source: '.pi', skills: [skills[1]] },
      { source: 'other', skills: [skills[0], skills[3]] },
    ])
  })

  it('formats user .pi skills from the Pi agent skill directory', () => {
    expect(getSkillSourcePath('.pi', 'user')).toBe('.pi/agent/skills')
    expect(getSkillSourcePath('.pi', 'project')).toBe('.pi/skills')
    expect(getSkillSourcePath('.agents', 'user')).toBe('.agents/skills')
  })

  it('builds stable identities for duplicate skill names', () => {
    const skill = makeSkill('review', '.pi', 'user')
    skill.file_name = 'review.md'

    expect(getSkillIdentity(skill)).toEqual({ name: 'review', level: 'user', source_dir: '.pi', file_name: 'review.md' })
  })

  it('defaults to a project skill when mixed project and user skills are present', () => {
    const skills = [
      makeSkill('alpha-personal', '.pi', 'user'),
      makeSkill('zeta-repository', '.agents', 'project'),
    ]

    expect(getPreferredSkillIdentity(skills, null)).toEqual(getSkillIdentity(skills[1]))
  })

  it('preserves an existing valid explicit selection', () => {
    const skills = [
      makeSkill('repository', '.agents', 'project'),
      makeSkill('personal', '.pi', 'user'),
    ]
    const explicitSelection = getSkillIdentity(skills[1])

    expect(getPreferredSkillIdentity(skills, explicitSelection)).toEqual(explicitSelection)
  })

  it('prefers project skills when replacing an invalid filtered selection', () => {
    const filteredSkills = [
      makeSkill('personal-match', '.pi', 'user'),
      makeSkill('repository-match', '.agents', 'project'),
    ]
    const missingSelection = getSkillIdentity(makeSkill('missing-personal', '.pi', 'user'))

    expect(getPreferredSkillIdentity(filteredSkills, missingSelection)).toEqual(getSkillIdentity(filteredSkills[1]))
  })
})
