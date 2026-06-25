import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedUserHome = vi.hoisted(() => ({ path: '' }))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => mockedUserHome.path },
    homedir: () => mockedUserHome.path,
  }
})

import backend from './backend'

function tempRoot(): string {
  return process.env.TMPDIR || '/tmp'
}

type BackendMethodHandler = (input: unknown) => Promise<unknown> | unknown

async function activateBackendWithProject(projectPath: string): Promise<Map<string, BackendMethodHandler>> {
  const methods = new Map<string, BackendMethodHandler>()
  const api = {
    backend: {
      registerMethod: vi.fn((method: string, registration: { handler: BackendMethodHandler }) => {
        methods.set(method, registration.handler)
        return { dispose: vi.fn() }
      }),
    },
    projects: {
      get: vi.fn(async (projectId: string) => ({ id: projectId, name: 'Project', path: projectPath, created_at: 1, updated_at: 1 })),
    },
  }

  await backend.activate(api as never, {
    pluginId: 'com.openforge.skills-viewer',
    apiVersion: 1,
    packageMetadata: {
      id: 'com.openforge.skills-viewer',
      apiVersion: 1,
      displayName: 'Skills Viewer',
      description: 'Browse and manage AI skills',
    },
    subscriptions: { add: vi.fn() },
  })

  return methods
}

async function createSkillFile(root: string, sourcePath: string, content: string): Promise<void> {
  const fullPath = join(root, sourcePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content)
}

describe('skills-viewer backend skill discovery', () => {
  beforeEach(async () => {
    mockedUserHome.path = await mkdtemp(join(tempRoot(), 'skills-viewer-user-home-'))
  })

  it('preserves literal multiline frontmatter descriptions', async () => {
    const projectPath = await mkdtemp(join(tempRoot(), 'skills-viewer-project-'))
    const skillDir = join(projectPath, '.agents', 'skills', 'review')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), `---\nname: review\ndescription: |\n  Review code carefully.\n  Preserve context.\n---\n# Review\n`)

    const methods = await activateBackendWithProject(projectPath)
    const skills = await methods.get('listSkills')?.({ projectId: 'P-1' })

    expect(Array.isArray(skills)).toBe(true)
    expect((skills as Array<{ name: string; description: string | null }>).find((skill) => skill.name === 'review'))
      .toMatchObject({ name: 'review', description: 'Review code carefully. Preserve context.' })
  })

  it('preserves folded multiline frontmatter descriptions', async () => {
    const projectPath = await mkdtemp(join(tempRoot(), 'skills-viewer-project-'))
    const skillDir = join(projectPath, '.agents', 'skills', 'plan')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), `---\nname: plan\ndescription: >\n  Plan the work.\n  Then execute.\n---\n# Plan\n`)

    const methods = await activateBackendWithProject(projectPath)
    const skills = await methods.get('listSkills')?.({ projectId: 'P-1' })

    expect(Array.isArray(skills)).toBe(true)
    expect((skills as Array<{ name: string; description: string | null }>).find((skill) => skill.name === 'plan'))
      .toMatchObject({ name: 'plan', description: 'Plan the work. Then execute.' })
  })

  it('returns same-name project and personal skills as distinct override entries', async () => {
    const projectPath = await mkdtemp(join(tempRoot(), 'skills-viewer-project-'))
    const userPath = await mkdtemp(join(tempRoot(), 'skills-viewer-user-'))
    mockedUserHome.path = userPath

    await createSkillFile(projectPath, '.agents/skills/review/SKILL.md', `---\nname: review\ndescription: Repository review skill\n---\n# Project review\n`)
    await createSkillFile(userPath, '.pi/agent/skills/review/SKILL.md', `---\nname: review\ndescription: Personal review skill\n---\n# Personal review\n`)

    const methods = await activateBackendWithProject(projectPath)
    const skills = await methods.get('listSkills')?.({ projectId: 'P-1' })

    expect((skills as Array<{ name: string; level: string; source_dir: string; file_name: string | null }>)
      .filter((skill) => skill.name === 'review')
      .map(({ name, level, source_dir, file_name }) => ({ name, level, source_dir, file_name })))
      .toEqual([
        { name: 'review', level: 'project', source_dir: '.agents', file_name: null },
        { name: 'review', level: 'user', source_dir: '.pi', file_name: null },
      ])
  })

  it('returns same-name Pi directory and root markdown skills as distinct entries', async () => {
    const projectPath = await mkdtemp(join(tempRoot(), 'skills-viewer-project-'))
    const userPath = await mkdtemp(join(tempRoot(), 'skills-viewer-user-'))
    mockedUserHome.path = userPath

    await createSkillFile(userPath, '.pi/agent/skills/review/SKILL.md', `---\nname: review\ndescription: Directory skill\n---\n# Directory skill\n`)
    await createSkillFile(userPath, '.pi/agent/skills/review.md', `---\nname: review\ndescription: Root markdown skill\n---\n# Root markdown skill\n`)

    const methods = await activateBackendWithProject(projectPath)
    const skills = await methods.get('listSkills')?.({ projectId: 'P-1' })

    expect((skills as Array<{ name: string; level: string; source_dir: string; source_path: string; file_name: string | null }>)
      .filter((skill) => skill.name === 'review')
      .map(({ name, level, source_dir, source_path, file_name }) => ({ name, level, source_dir, source_path, file_name })))
      .toEqual([
        { name: 'review', level: 'user', source_dir: '.pi', source_path: 'review', file_name: null },
        { name: 'review', level: 'user', source_dir: '.pi', source_path: 'review.md', file_name: 'review.md' },
      ])
  })

  it('saves directory-backed skills by listed source folder instead of frontmatter name', async () => {
    const projectPath = await mkdtemp(join(tempRoot(), 'skills-viewer-project-'))
    await createSkillFile(projectPath, '.agents/skills/folder-review/SKILL.md', `---\nname: display-review\ndescription: Display name\n---\n# Before\n`)

    const methods = await activateBackendWithProject(projectPath)
    const skills = await methods.get('listSkills')?.({ projectId: 'P-1' })
    const skill = (skills as Array<{ name: string; source_path: string }>).find((candidate) => candidate.name === 'display-review')

    expect(skill).toMatchObject({ name: 'display-review', source_path: 'folder-review' })

    await methods.get('saveSkillContent')?.({
      projectId: 'P-1',
      name: 'display-review',
      sourcePath: 'folder-review',
      level: 'project',
      sourceDir: '.agents',
      content: '# After\n',
    })

    await expect(readFile(join(projectPath, '.agents/skills/folder-review/SKILL.md'), 'utf8')).resolves.toBe('# After\n')
    await expect(stat(join(projectPath, '.agents/skills/display-review'))).rejects.toThrow()
  })
})
