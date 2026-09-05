import { describe, expect, it } from 'vitest'
import {
  createFileEntry,
  createProject,
  createPullRequest,
  createStorySettings,
  createTask,
  createTaskWorkspaceInfo,
  createTextFileContent,
} from './appFixtures'

describe('shared app fixture builders', () => {
  it('creates independent task and review fixtures with explicit overrides', () => {
    const first = createTask({ id: 'T-first', labels: [{ id: 1, projectId: 'project-1', name: 'ui' }] })
    const second = createTask()
    first.labels.push({ id: 2, projectId: 'project-1', name: 'bug' })

    expect(second.labels).toEqual([])
    expect(createPullRequest({ ticket_id: first.id })).toMatchObject({ ticket_id: 'T-first', state: 'open' })
  })

  it('creates representative project, workspace, file, and settings fixtures', () => {
    expect(createProject({ name: 'Catalog' })).toMatchObject({ name: 'Catalog', path: '/workspace/openforge' })
    expect(createTaskWorkspaceInfo({ status: 'creating' })).toMatchObject({ task_id: 'T-42', status: 'creating' })
    expect(createFileEntry({ name: 'src' })).toMatchObject({ name: 'src', path: 'README.md' })
    expect(createTextFileContent({ content: '# Storybook' })).toMatchObject({ type: 'text', size: 11 })
    expect(createStorySettings({ theme: 'openforge-light' })).toEqual({
      config: { theme: 'openforge-light', provider: 'pi' },
      projectConfig: { 'project-1': { provider: 'codex' } },
    })
  })
})
