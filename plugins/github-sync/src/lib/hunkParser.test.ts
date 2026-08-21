import { describe, it, expect } from 'vitest'
import { parseHunks, buildPatchFromHunks, selectHunksByIndex, commentableLines } from './hunkParser'

describe('parseHunks', () => {
  it('returns empty array for null', () => {
    expect(parseHunks(null)).toEqual([])
  })

  it('returns empty array for undefined', () => {
    expect(parseHunks(undefined)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseHunks('')).toEqual([])
  })

  it('returns empty array when patch has no hunk headers', () => {
    expect(parseHunks('not a real diff\nno hunk header')).toEqual([])
  })

  it('parses a single hunk', () => {
    const patch = `@@ -1,3 +1,4 @@
 unchanged line
-old line
+new line
+another new line`
    const hunks = parseHunks(patch)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].index).toBe(0)
    expect(hunks[0].text).toBe(patch)
  })

  it('parses multiple hunks in order', () => {
    const patch = `@@ -1,2 +1,2 @@
 a
-b
+B
@@ -10,2 +10,3 @@ context
 x
+y
 z`
    const hunks = parseHunks(patch)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].index).toBe(0)
    expect(hunks[0].text.startsWith('@@ -1,2 +1,2 @@')).toBe(true)
    expect(hunks[1].index).toBe(1)
    expect(hunks[1].text.startsWith('@@ -10,2 +10,3 @@ context')).toBe(true)
    expect(hunks[1].text).toContain('+y')
  })

  it('ignores leading lines before the first @@ header', () => {
    const patch = `--- a/file
+++ b/file
@@ -1,1 +1,1 @@
-old
+new`
    const hunks = parseHunks(patch)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].text.startsWith('@@')).toBe(true)
  })

  it('preserves blank lines inside a hunk body', () => {
    const patch = `@@ -1,3 +1,3 @@
 a

-b
+B`
    const hunks = parseHunks(patch)
    expect(hunks[0].text.split('\n')).toEqual(['@@ -1,3 +1,3 @@', ' a', '', '-b', '+B'])
  })
})

describe('buildPatchFromHunks', () => {
  it('returns null for empty array', () => {
    expect(buildPatchFromHunks([])).toBeNull()
  })

  it('joins hunks in original index order even if input is reordered', () => {
    const hunks = parseHunks(`@@ -1,1 +1,1 @@
-a
+A
@@ -5,1 +5,1 @@
-b
+B`)
    const reversed = [...hunks].reverse()
    const patch = buildPatchFromHunks(reversed)
    expect(patch).not.toBeNull()
    const lines = patch!.split('\n')
    expect(lines[0]).toBe('@@ -1,1 +1,1 @@')
    expect(lines).toContain('@@ -5,1 +5,1 @@')
    expect(lines.indexOf('@@ -1,1 +1,1 @@')).toBeLessThan(lines.indexOf('@@ -5,1 +5,1 @@'))
  })

  it('roundtrips parse → build for the original patch', () => {
    const original = `@@ -1,2 +1,2 @@
 a
-b
+B
@@ -10,2 +10,3 @@
 x
+y
 z`
    const hunks = parseHunks(original)
    expect(buildPatchFromHunks(hunks)).toBe(original)
  })
})

describe('selectHunksByIndex', () => {
  const all = [
    { index: 0, text: '@@ -1,1 +1,1 @@\n-a\n+A' },
    { index: 1, text: '@@ -5,1 +5,1 @@\n-b\n+B' },
    { index: 2, text: '@@ -9,1 +9,1 @@\n-c\n+C' },
  ]

  it('returns all hunks when indexes is null', () => {
    expect(selectHunksByIndex(all, null)).toEqual(all)
  })

  it('returns all hunks when indexes is undefined', () => {
    expect(selectHunksByIndex(all, undefined)).toEqual(all)
  })

  it('returns only matching hunks when indexes is given', () => {
    const result = selectHunksByIndex(all, [0, 2])
    expect(result).toHaveLength(2)
    expect(result[0].index).toBe(0)
    expect(result[1].index).toBe(2)
  })

  it('silently drops indexes that do not exist', () => {
    expect(selectHunksByIndex(all, [99])).toEqual([])
  })

  it('returns empty array when indexes is empty', () => {
    expect(selectHunksByIndex(all, [])).toEqual([])
  })
})

describe('commentableLines', () => {
  it('maps context/added lines to RIGHT and context/removed to LEFT', () => {
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' context1',   // old 1, new 1
      '-removed',     // old 2
      '+added1',      // new 2
      '+added2',      // new 3
      ' context2',   // old 3, new 4
    ].join('\n')
    const { right, left } = commentableLines(patch)
    expect([...right].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect([...left].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })
  it('returns empty sets for empty/absent patch', () => {
    expect(commentableLines(null).right.size).toBe(0)
    expect(commentableLines('').left.size).toBe(0)
  })
})
