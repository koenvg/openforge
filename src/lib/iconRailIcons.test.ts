import { Clock, Plug } from 'lucide-svelte'
import { describe, expect, it } from 'vitest'
import { resolveIconRailIcon } from './iconRailIcons'

describe('resolveIconRailIcon', () => {
  it('resolves the task schedules clock icon instead of using the fallback', () => {
    expect(resolveIconRailIcon('clock')).toBe(Clock)
  })

  it('falls back to Plug for unsupported plugin icon names', () => {
    expect(resolveIconRailIcon('unsupported-icon')).toBe(Plug)
  })
})
