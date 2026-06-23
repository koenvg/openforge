import { describe, expect, it } from 'vitest'
import { getPreferredSkillIdentity, getSkillIdentity, getSkillLocationLabel, getSkillSourcePath, groupSkillsBySource, type SkillInfo } from './skillDomain'

function makeSkill(name: string, source_dir: string, level: SkillInfo['level'] = 'project'): SkillInfo {
  return { name, source_dir, level, description: null, agent: null, template: null, directory_name: name, file_name: null }
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

  it('formats skill locations with root markdown file names for duplicate disambiguation', () => {
    const directorySkill = makeSkill('review', '.pi', 'user')
    const rootMarkdownSkill = makeSkill('review', '.pi', 'user')
    rootMarkdownSkill.file_name = 'review.md'

    expect(getSkillLocationLabel(directorySkill)).toBe('~/.pi/agent/skills/review/SKILL.md')
    expect(getSkillLocationLabel(rootMarkdownSkill)).toBe('~/.pi/agent/skills/review.md')
  })

  it('builds stable identities for duplicate skill names', () => {
    const skill = makeSkill('review', '.pi', 'user')
    skill.file_name = 'review.md'
    skill.directory_name = null

    expect(getSkillIdentity(skill)).toEqual({ name: 'review', level: 'user', source_dir: '.pi', directory_name: null, file_name: 'review.md' })
  })

  it('distinguishes same-name directory skills by directory identity', () => {
    const alpha = makeSkill('review', '.agents', 'project')
    const beta = makeSkill('review', '.agents', 'project')
    alpha.directory_name = 'alpha-review'
    beta.directory_name = 'beta-review'

    expect(getSkillIdentity(alpha)).not.toEqual(getSkillIdentity(beta))
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
