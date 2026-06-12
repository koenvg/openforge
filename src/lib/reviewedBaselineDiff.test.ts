import { describe, expect, it } from 'vitest'
import { buildReviewedBaselineComparison } from './reviewedBaselineDiff'
import type { PrFileDiff } from './types'

function diff(overrides: Partial<PrFileDiff> = {}): PrFileDiff {
  return {
    sha: 'current-sha',
    filename: 'src/feature.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: '@@ -1,1 +1,1 @@\n-old\n+new',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    ...overrides,
  }
}

describe('buildReviewedBaselineComparison', () => {
  it('builds a diff only for files whose current identity differs from their reviewed snapshot', async () => {
    const changed = diff({ filename: 'src/changed.ts', sha: 'new-sha' })
    const unchanged = diff({ filename: 'src/unchanged.ts', sha: 'same-sha' })

    const result = await buildReviewedBaselineComparison({
      files: [changed, unchanged],
      snapshots: new Map([
        ['src/changed.ts', { identity: 'old-sha', newContent: 'old line\n' }],
        ['src/unchanged.ts', { identity: 'same-sha', newContent: 'same line\n' }],
      ]),
      getFileIdentity: (file) => file.sha,
      fetchCurrentContents: async (files) => new Map(files.map((file) => [file.filename, {
        oldContent: '',
        newContent: file.filename === 'src/changed.ts' ? 'new line\n' : 'same line\n',
      }])),
    })

    expect(result.files.map((file) => file.filename)).toEqual(['src/changed.ts'])
    expect(result.contents.get('src/changed.ts')).toEqual({ oldContent: 'old line\n', newContent: 'new line\n' })
    expect(result.files[0]?.patch).toContain('-old line')
    expect(result.files[0]?.patch).toContain('+new line')
  })

  it('returns no comparison when a file has no reconstructable current identity', async () => {
    const result = await buildReviewedBaselineComparison({
      files: [diff({ sha: '' })],
      snapshots: new Map([['src/feature.ts', { identity: 'old-sha', newContent: 'old\n' }]]),
      getFileIdentity: () => null,
      fetchCurrentContents: async () => new Map(),
    })

    expect(result.files).toEqual([])
    expect(result.contents).toEqual(new Map())
  })
})
