import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import backend from './backend'

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

describe('skills-viewer backend skill discovery', () => {
  it('preserves literal multiline frontmatter descriptions', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'skills-viewer-project-'))
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
    const projectPath = await mkdtemp(join(tmpdir(), 'skills-viewer-project-'))
    const skillDir = join(projectPath, '.agents', 'skills', 'plan')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), `---\nname: plan\ndescription: >\n  Plan the work.\n  Then execute.\n---\n# Plan\n`)

    const methods = await activateBackendWithProject(projectPath)
    const skills = await methods.get('listSkills')?.({ projectId: 'P-1' })

    expect(Array.isArray(skills)).toBe(true)
    expect((skills as Array<{ name: string; description: string | null }>).find((skill) => skill.name === 'plan'))
      .toMatchObject({ name: 'plan', description: 'Plan the work. Then execute.' })
  })
})
