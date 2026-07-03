import { render } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '@openforge/plugin-sdk/domain'
import DiffViewer from './DiffViewer.svelte'

// Regression for the AI Walkthrough tab: stepping to a walkthrough step with fewer
// files swaps in a smaller `files` prop. The virtualizer's reactive `virtualItems`
// briefly still reflects the PRE-shrink row count, so it emits row.index values that
// are >= sortedFiles.length and DiffViewer would dereference an undefined file
// (`Cannot read properties of undefined`). We model that transient deterministically
// with a per-instance high-water row count that never shrinks below what it has seen.
vi.mock('./useVirtualizer.svelte', () => ({
  createVirtualizer: vi.fn((opts: { getCount: () => number }) => {
    let highWaterCount = 0
    return {
      get virtualItems() {
        highWaterCount = Math.max(highWaterCount, opts.getCount())
        return Array.from({ length: highWaterCount }, (_, index) => ({
          key: index,
          index,
          start: index * 300,
          end: (index + 1) * 300,
          size: 300,
          lane: 0,
        }))
      },
      totalSize: 300,
      scrollToIndex: vi.fn(),
      measureAction: () => ({ destroy() {} }),
    }
  }),
}))

vi.mock('./useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn(() => ({
    getDiffFile: () => null,
  })),
}))

function makeFile(name: string): PrFileDiff {
  return {
    sha: `sha-${name}`,
    filename: name,
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: '@@ -1 +1 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  }
}

describe('DiffViewer walkthrough step shrink', () => {
  it('does not crash when the files prop shrinks below the current virtualizer row count', async () => {
    const threeFiles = [makeFile('a.ts'), makeFile('b.ts'), makeFile('c.ts')]
    const { rerender } = render(DiffViewer, { props: { files: threeFiles } })

    let thrown: unknown = null
    try {
      // A later walkthrough step renders only one file; virtualItems lags at 3 rows,
      // so rows for the removed files resolve to undefined via sortedFiles[row.index].
      await rerender({ files: [makeFile('a.ts')] })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeNull()
  })
})
