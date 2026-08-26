import { describe, expect, it } from 'vitest'
import { FILE_VIEWER_VIEW_KEY } from './fileViewerPlugin'
import { GITHUB_SYNC_VIEW_KEY } from './githubSyncPlugin'
import { TASK_SCHEDULES_VIEW_KEY } from './taskSchedulesPlugin'
import { getIconRailNavItems } from './iconRailNav'

describe('getIconRailNavItems', () => {
  it('keeps Project Settings last after plugin rail items', () => {
    const items = getIconRailNavItems([
      {
        viewKey: GITHUB_SYNC_VIEW_KEY,
        icon: 'git-pull-request',
        title: 'PR Review',
        shortcut: '⌘G',
      },
      {
        viewKey: TASK_SCHEDULES_VIEW_KEY,
        icon: 'clock',
        title: 'Task Schedules',
        shortcut: '⌘S',
      },
    ])

    expect(items.map((item) => item.label)).toEqual(['Board', 'PR Review', 'Task Schedules', 'Project Settings'])
  })

  it('normalizes shortcut hints for plugin-provided rail items', () => {
    const items = getIconRailNavItems([
      {
        viewKey: FILE_VIEWER_VIEW_KEY,
        icon: 'folder-open',
        title: 'Files',
        shortcut: '⌘⇧o',
      },
    ])

    expect(items.find((item) => item.label === 'Files')?.shortcut).toBe('O')
  })
})
