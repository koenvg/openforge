import { describe, expect, it } from 'vitest'
import { getDependencyStatusPresentation } from './dependencyStatusPresentation'
import type { BoardStatus } from './types'

describe('getDependencyStatusPresentation', () => {
  it.each([
    ['done', 'done', 'success', 'status-success'],
    ['doing', 'doing', 'warning', 'status-warning'],
    ['backlog', 'backlog', 'neutral', 'status-neutral'],
    [null, 'unknown', 'neutral', 'status-neutral'],
  ] satisfies Array<[BoardStatus | null, string, string, string]>)(
    'maps %s dependencies to semantic status presentation',
    (status, label, tone, badgeVariant) => {
      expect(getDependencyStatusPresentation(status)).toEqual({ label, tone, badgeVariant })
    },
  )
})
