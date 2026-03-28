import { describe, expect, it } from 'vitest'

import { getProjectIdentity, mergeUpdatedProject } from './settingsProjectSync'

describe('settingsProjectSync', () => {
  it('returns blank identity when there is no active project', () => {
    expect(getProjectIdentity(null, [])).toEqual({
      projectName: '',
      projectPath: '',
    })
  })

  it('returns the active project name and path from the projects list', () => {
    expect(getProjectIdentity('project-2', [
      { id: 'project-1', name: 'One', path: '/tmp/one', created_at: 1, updated_at: 1 },
      { id: 'project-2', name: 'Two', path: '/tmp/two', created_at: 2, updated_at: 2 },
    ])).toEqual({
      projectName: 'Two',
      projectPath: '/tmp/two',
    })
  })

  it('merges updated project identity into the project list without changing other projects', () => {
    expect(mergeUpdatedProject([
      { id: 'project-1', name: 'One', path: '/tmp/one', created_at: 1, updated_at: 1 },
      { id: 'project-2', name: 'Two', path: '/tmp/two', created_at: 2, updated_at: 2 },
    ], {
      id: 'project-2',
      name: 'Updated',
      path: '/tmp/updated',
    })).toEqual([
      { id: 'project-1', name: 'One', path: '/tmp/one', created_at: 1, updated_at: 1 },
      { id: 'project-2', name: 'Updated', path: '/tmp/updated', created_at: 2, updated_at: 2 },
    ])
  })
})
