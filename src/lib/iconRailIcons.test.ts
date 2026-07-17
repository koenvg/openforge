import { Clock, Kanban, Plug } from '@lucide/svelte'
import { describe, expect, it } from 'vitest'
import { resolveIconRailIcon, resolvePluginNavigationIcon } from './iconRailIcons'

describe('resolveIconRailIcon', () => {
  it('resolves the task schedules clock icon instead of using the fallback', () => {
    expect(resolveIconRailIcon('clock')).toBe(Clock)
  })

  it('resolves the roadmap kanban icon instead of using the fallback', () => {
    expect(resolveIconRailIcon('kanban')).toBe(Kanban)
  })

  it('falls back to Plug for unsupported plugin icon names', () => {
    expect(resolveIconRailIcon('unsupported-icon')).toBe(Plug)
  })

  it('resolves sanitized custom SVG icons without using the named-icon registry', () => {
    expect(resolvePluginNavigationIcon({
      type: 'svg',
      svg: '<svg viewBox="0 0 24 24"><path d="M12 2 22 12 12 22 2 12Z" fill="currentColor"/></svg>',
    })).toMatchObject({
      type: 'svg',
      svg: expect.stringContaining('M12 2 22 12 12 22 2 12Z'),
    })
  })

  it('falls back to Plug when custom SVG icon data is invalid', () => {
    expect(resolvePluginNavigationIcon({ type: 'svg', svg: '<svg></svg>' })).toEqual({
      type: 'component',
      component: Plug,
    })
  })
})
