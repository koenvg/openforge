import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getPreferredSkillIdentity, getSkillIdentity, getSkillLocationLabel, getSkillSourcePath, getVisibleSkills, groupSkillsBySource, isSameSkillIdentity, parseSkillFrontmatter, SKILL_SOURCE_DIRS, stripSkillFrontmatter, type SkillInfo } from './skillDomain'

function makeSkill(name: string, source_dir: string, level: SkillInfo['level'] = 'project', relative_path = `${name}/SKILL.md`): SkillInfo {
  const source_path = relative_path.endsWith('/SKILL.md')
    ? relative_path.slice(0, -'/SKILL.md'.length)
    : relative_path
  return { name, source_dir, source_path, level, description: null, agent: null, template: null, file_name: null, relative_path }
}

function rustCommandDiscoverySkillSourceDirs(): string[] {
  const testDir = dirname(fileURLToPath(import.meta.url))
  const rustSource = readFileSync(resolve(testDir, '../../../../src-tauri/src/command_discovery.rs'), 'utf8')
  const match = /pub const SKILL_SOURCE_DIRS: \[&str; \d+\] = \[([\s\S]*?)\];/.exec(rustSource)
  expect(match).not.toBeNull()

  return Array.from(match?.[1].matchAll(/"(\.\w+)"|([A-Z_]+_SKILLS_SOURCE_DIR)/g) ?? []).map((sourceMatch) => {
    if (sourceMatch[1]) return sourceMatch[1]
    const constantMatch = new RegExp(`pub const ${sourceMatch[2]}: &str = "(\\.\\w+)";`).exec(rustSource)
    expect(constantMatch).not.toBeNull()
    return constantMatch?.[1] ?? ''
  })
}

describe('skills-viewer skill domain helpers', () => {
  it('keeps supported provider skill source directories aligned with Rust command discovery', () => {
    expect(SKILL_SOURCE_DIRS).toEqual(rustCommandDiscoverySkillSourceDirs())
    expect(SKILL_SOURCE_DIRS).toContain('.codex')
  })

  it('groups skills by known provider source order and appends unknown sources to other', () => {
    const skills = [
      makeSkill('custom', '.custom'),
      makeSkill('pi', '.pi'),
      makeSkill('agents', '.agents'),
      makeSkill('other-custom', '.another'),
      makeSkill('opencode', '.opencode'),
      makeSkill('codex', '.codex'),
    ]

    expect(groupSkillsBySource(skills)).toEqual([
      { source: '.agents', skills: [skills[2]] },
      { source: '.opencode', skills: [skills[4]] },
      { source: '.codex', skills: [skills[5]] },
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
    const directorySkill = makeSkill('display-review', '.pi', 'user', 'review-folder/SKILL.md')
    const rootMarkdownSkill = makeSkill('review', '.pi', 'user', 'review.md')
    rootMarkdownSkill.file_name = 'review.md'

    expect(getSkillLocationLabel(directorySkill)).toBe('~/.pi/agent/skills/review-folder/SKILL.md')
    expect(getSkillLocationLabel(rootMarkdownSkill)).toBe('~/.pi/agent/skills/review.md')
  })

  it('formats directory skill locations from the discovered path instead of frontmatter name', () => {
    const skill = makeSkill('frontmatter-name', '.agents', 'project', 'folder-name/SKILL.md')

    expect(getSkillLocationLabel(skill)).toBe('.agents/skills/folder-name/SKILL.md')
  })

  it('builds stable identities for duplicate skill names', () => {
    const skill = makeSkill('review', '.pi', 'user', 'review.md')
    skill.file_name = 'review.md'

    expect(getSkillIdentity(skill)).toEqual({ level: 'user', source_dir: '.pi', source_path: 'review.md', file_name: 'review.md', relative_path: 'review.md' })
  })

  it('distinguishes same-source directory skills with the same frontmatter name by relative path', () => {
    const alpha = makeSkill('review', '.agents', 'project', 'alpha/SKILL.md')
    const beta = makeSkill('review', '.agents', 'project', 'beta/SKILL.md')

    expect(isSameSkillIdentity(alpha, getSkillIdentity(beta))).toBe(false)
    expect(isSameSkillIdentity(beta, getSkillIdentity(beta))).toBe(true)
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

  it('preserves a path-based selection when saved frontmatter renames the skill', () => {
    const currentIdentity = getSkillIdentity(makeSkill('review', '.agents', 'project', 'folder/SKILL.md'))
    const renamedSkill = makeSkill('renamed-review', '.agents', 'project', 'folder/SKILL.md')

    expect(getPreferredSkillIdentity([renamedSkill], currentIdentity)).toEqual(currentIdentity)
  })

  it('parses frontmatter metadata for saved skill content', () => {
    expect(parseSkillFrontmatter('---\nname: updated-review\ndescription: Updated review helper\n---\n# Review\n'))
      .toEqual({ name: 'updated-review', description: 'Updated review helper' })
  })

  it('parses literal and folded multiline frontmatter descriptions', () => {
    expect(parseSkillFrontmatter('---\nname: review\ndescription: |\n  Review code carefully.\n  Preserve context.\n---\n# Review\n'))
      .toEqual({ name: 'review', description: 'Review code carefully. Preserve context.' })
    expect(parseSkillFrontmatter('---\nname: plan\ndescription: >\n  Plan the work.\n  Then execute.\n---\n# Plan\n'))
      .toEqual({ name: 'plan', description: 'Plan the work. Then execute.' })
  })

  it('strips complete YAML frontmatter for rendered skill markdown', () => {
    const content = '---\nname: review\ndescription: Review code\n---\n# Review\nUse [docs](https://example.com).\n'

    expect(stripSkillFrontmatter(content)).toBe('# Review\nUse [docs](https://example.com).\n')
  })

  it('leaves non-frontmatter and malformed frontmatter-like content unchanged', () => {
    const bodyOnly = '# Review\n---\nKeep separator in the body.\n'
    const malformed = '---\nname: missing-close\n# Review\n'

    expect(stripSkillFrontmatter(bodyOnly)).toBe(bodyOnly)
    expect(stripSkillFrontmatter(malformed)).toBe(malformed)
  })

  it('strips frontmatter with CRLF line endings without changing the body', () => {
    expect(stripSkillFrontmatter('---\r\nname: review\r\n---\r\n# Review\r\n')).toBe('# Review\r\n')
  })

  it('derives visible skills in rendered group order while respecting collapsed levels and sources', () => {
    const skills = [
      makeSkill('repo-agents', '.agents', 'project'),
      makeSkill('repo-pi', '.pi', 'project'),
      makeSkill('personal-agents', '.agents', 'user'),
      makeSkill('personal-pi', '.pi', 'user'),
    ]

    expect(getVisibleSkills(skills, new Map())).toEqual(skills)

    expect(getVisibleSkills(skills, new Map([['project:.agents', true]]))).toEqual([
      skills[1],
      skills[2],
      skills[3],
    ])

    expect(getVisibleSkills(skills, new Map([['project', true]]))).toEqual([
      skills[2],
      skills[3],
    ])

    expect(getVisibleSkills(skills, new Map([['user', true]]))).toEqual([
      skills[0],
      skills[1],
    ])
  })
})
