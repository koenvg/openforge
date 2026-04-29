import { describe, expect, it } from 'vitest'
import { getIconRailNavItems } from './iconRailNav'
import type { AppView } from './types'

describe('getIconRailNavItems', () => {
  it('keeps Settings last after plugin rail items', () => {
    const items = getIconRailNavItems([
      {
        viewKey: 'plugin:com.openforge.github-sync:pr_review' as AppView,
        icon: 'git-pull-request',
        title: 'PR Review',
        shortcut: '⌘G',
      },
      {
        viewKey: 'plugin:com.openforge.skills-viewer:skills' as AppView,
        icon: 'sparkles',
        title: 'Skills',
        shortcut: '⌘L',
      },
    ])

    expect(items.map((item) => item.label)).toEqual(['Board', 'PR Review', 'Skills', 'Settings'])
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
