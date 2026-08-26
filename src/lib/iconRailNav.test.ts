import { describe, expect, it } from 'vitest'
import { GITHUB_SYNC_VIEW_KEY } from './githubSyncPlugin'
import { getIconRailNavItems } from './iconRailNav'
import type { AppView } from './types'

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
        viewKey: 'plugin:com.openforge.task-schedules:schedules' as AppView,
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
        viewKey: 'plugin:com.openforge.file-viewer:files' as AppView,
        icon: 'folder-open',
        title: 'Files',
        shortcut: '⌘⇧o',
      },
    ])

    expect(items.find((item) => item.label === 'Files')?.shortcut).toBe('O')
  })
})
