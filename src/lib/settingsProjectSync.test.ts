import { describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  resetProjectSettingsToGlobal: vi.fn(),
}))

import { resetProjectSettingsToGlobal } from './ipc'
import { getProjectIdentity, mergeUpdatedProject, resetProjectAndReload } from './settingsProjectSync'

describe('settingsProjectSync', () => {
  it('resets project overrides then reloads', async () => {
    vi.mocked(resetProjectSettingsToGlobal).mockResolvedValue(undefined)
    const reload = vi.fn().mockResolvedValue(undefined)

    await resetProjectAndReload('P-1', reload)

    expect(resetProjectSettingsToGlobal).toHaveBeenCalledWith('P-1')
    expect(reload).toHaveBeenCalled()
  })

  it('reloads only after the reset has resolved', async () => {
    const order: string[] = []
    vi.mocked(resetProjectSettingsToGlobal).mockImplementation(async () => {
      order.push('reset')
    })
    const reload = vi.fn().mockImplementation(async () => {
      order.push('reload')
    })

    await resetProjectAndReload('P-2', reload)

    expect(order).toEqual(['reset', 'reload'])
  })

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
