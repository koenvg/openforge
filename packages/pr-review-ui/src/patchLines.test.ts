import { describe, it, expect } from 'vitest'
import { commentableLines } from './patchLines'

describe('commentableLines', () => {
  it('maps context/added lines to RIGHT and context/removed to LEFT', () => {
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' context1',
      '-removed',
      '+added1',
      '+added2',
      ' context2',
    ].join('\n')

    const { right, left } = commentableLines(patch)

    expect([...right].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect([...left].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('returns empty sets for empty/absent patch', () => {
    expect(commentableLines(null).right.size).toBe(0)
    expect(commentableLines('').left.size).toBe(0)
  })

  it('numbers each hunk from its own header', () => {
    const patch = [
      '@@ -1,2 +1,2 @@',
      ' first',
      '@@ -40,2 +50,2 @@',
      ' second',
      '+third',
    ].join('\n')

    const { right, left } = commentableLines(patch)

    expect([...right].sort((a, b) => a - b)).toEqual([1, 50, 51])
    expect([...left].sort((a, b) => a - b)).toEqual([1, 40])
  })
})
