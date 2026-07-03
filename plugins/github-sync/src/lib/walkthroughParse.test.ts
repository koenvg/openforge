import { describe, it, expect } from 'vitest'
import { parseAndValidateWalkthroughSteps } from './walkthroughParse'
import type { PrFileDiff } from '@openforge/plugin-sdk/domain'

function file(filename: string, hunkCount: number): PrFileDiff {
  // Build a patch with `hunkCount` distinct hunks so parseHunks() returns that many.
  const hunks: string[] = []
  for (let i = 0; i < hunkCount; i++) {
    const start = i * 10 + 1
    hunks.push(`@@ -${start},1 +${start},1 @@\n-old${i}\n+new${i}`)
  }
  return {
    sha: 'sha',
    filename,
    status: 'modified',
    additions: hunkCount,
    deletions: hunkCount,
    changes: hunkCount * 2,
    patch: hunks.length > 0 ? hunks.join('\n') : null,
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  }
}

describe('parseAndValidateWalkthroughSteps', () => {
  it('returns null for empty/null/undefined input', () => {
    expect(parseAndValidateWalkthroughSteps(null, [])).toBeNull()
    expect(parseAndValidateWalkthroughSteps('', [])).toBeNull()
    expect(parseAndValidateWalkthroughSteps(undefined, [])).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(parseAndValidateWalkthroughSteps('not json', [])).toBeNull()
  })

  it('returns null when steps is missing or not an array', () => {
    expect(parseAndValidateWalkthroughSteps('{}', [])).toBeNull()
    expect(parseAndValidateWalkthroughSteps('{"steps": "x"}', [])).toBeNull()
  })

  it('parses a valid walkthrough', () => {
    const files = [file('a.ts', 2), file('b.ts', 1)]
    const json = JSON.stringify({
      steps: [
        {
          id: 'step-1',
          title: 'First',
          summary: 'Does the first thing.',
          files: [{ filename: 'a.ts', hunk_indexes: [0] }],
        },
        {
          id: 'step-2',
          title: 'Second',
          summary: 'Does the second thing.',
          files: [
            { filename: 'a.ts', hunk_indexes: [1] },
            { filename: 'b.ts', hunk_indexes: null },
          ],
        },
      ],
    })
    const out = parseAndValidateWalkthroughSteps(json, files)
    expect(out).toHaveLength(2)
    expect(out![0].id).toBe('step-1')
    expect(out![1].files).toHaveLength(2)
  })

  it('drops files whose filename is not in the diff', () => {
    const files = [file('a.ts', 1)]
    const json = JSON.stringify({
      steps: [
        {
          id: 'step-1',
          title: 'x',
          summary: 'y',
          files: [
            { filename: 'a.ts', hunk_indexes: [0] },
            { filename: 'ghost.ts', hunk_indexes: [0] },
          ],
        },
      ],
    })
    const out = parseAndValidateWalkthroughSteps(json, files)
    expect(out![0].files).toHaveLength(1)
    expect(out![0].files[0].filename).toBe('a.ts')
  })

  it('drops out-of-range hunk indexes', () => {
    const files = [file('a.ts', 2)]
    const json = JSON.stringify({
      steps: [
        {
          id: 'step-1',
          title: 'x',
          summary: 'y',
          files: [{ filename: 'a.ts', hunk_indexes: [0, 99, 1] }],
        },
      ],
    })
    const out = parseAndValidateWalkthroughSteps(json, files)
    expect(out![0].files[0].hunk_indexes).toEqual([0, 1])
  })

  it('drops a step that ends up with no valid files', () => {
    const files = [file('a.ts', 1)]
    const json = JSON.stringify({
      steps: [
        {
          id: 'step-1',
          title: 'x',
          summary: 'y',
          files: [{ filename: 'ghost.ts', hunk_indexes: [0] }],
        },
        {
          id: 'step-2',
          title: 'keep',
          summary: 's',
          files: [{ filename: 'a.ts', hunk_indexes: [0] }],
        },
      ],
    })
    const out = parseAndValidateWalkthroughSteps(json, files)
    expect(out).toHaveLength(1)
    expect(out![0].id).toBe('step-2')
  })

  it('preserves null hunk_indexes (means whole file)', () => {
    const files = [file('a.ts', 3)]
    const json = JSON.stringify({
      steps: [
        {
          id: 'step-1',
          title: 't',
          summary: 's',
          files: [{ filename: 'a.ts', hunk_indexes: null }],
        },
      ],
    })
    const out = parseAndValidateWalkthroughSteps(json, files)
    expect(out![0].files[0].hunk_indexes).toBeNull()
  })

  it('treats undefined hunk_indexes as null (whole file)', () => {
    const files = [file('a.ts', 3)]
    const json = JSON.stringify({
      steps: [
        {
          id: 'step-1',
          title: 't',
          summary: 's',
          files: [{ filename: 'a.ts' }],
        },
      ],
    })
    const out = parseAndValidateWalkthroughSteps(json, files)
    expect(out![0].files[0].hunk_indexes).toBeNull()
  })

  it('drops steps missing required string fields', () => {
    const files = [file('a.ts', 1)]
    const json = JSON.stringify({
      steps: [
        { id: 's1', title: 'ok', summary: 'ok', files: [{ filename: 'a.ts', hunk_indexes: [0] }] },
        { id: 's2', files: [{ filename: 'a.ts' }] },
      ],
    })
    const out = parseAndValidateWalkthroughSteps(json, files)
    expect(out).toHaveLength(1)
    expect(out![0].id).toBe('s1')
  })

  it('returns null when nothing valid remains', () => {
    const files = [file('a.ts', 1)]
    const json = JSON.stringify({
      steps: [
        { id: 's1', title: 't', summary: 's', files: [{ filename: 'ghost.ts' }] },
      ],
    })
    expect(parseAndValidateWalkthroughSteps(json, files)).toBeNull()
  })
})
