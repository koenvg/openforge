import { vi } from 'vitest'

const { mockDiffView, mockDiffHighlighter } = vi.hoisted(() => ({
  mockDiffView: vi.fn().mockReturnValue(null),
  mockDiffHighlighter: { name: 'test-highlighter', type: 'class' },
}))

declare global {
  // eslint-disable-next-line no-var
  var __diffViewerTestWidget: { lineNumber: number; side: number } | undefined
}

vi.mock('@git-diff-view/svelte', async () => {
  const { default: DiffViewTestMock } = await import('./DiffViewTestMock.svelte')
  return {
    DiffView: (anchor: Node, props: Record<string, unknown>) => {
      mockDiffView(anchor, props)
      return (DiffViewTestMock as unknown as (anchor: Node, props: Record<string, unknown>) => unknown)(anchor, props)
    },
    DiffModeEnum: { Split: 0, Unified: 1 },
    SplitSide: { old: 1, new: 2 },
  }
})

vi.mock('@openforge-app/pr-review-ui/useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn().mockReturnValue({
    getDiffFile: () => undefined,
    processing: false,
  }),
}))

vi.mock('@openforge-app/pr-review-ui/diffSearch', () => ({
  findMatchesInContainer: vi.fn().mockReturnValue([]),
  applySearchHighlights: vi.fn(),
  applyOccurrenceHighlights: vi.fn(),
  clearSearchHighlights: vi.fn(),
  clearOccurrenceHighlights: vi.fn(),
  getWordAtSelection: vi.fn().mockReturnValue(null),
  scrollToMatch: vi.fn(),
  countMatchesInPatch: vi.fn().mockReturnValue(0),
}))

vi.mock('@openforge-app/pr-review-ui/diffAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openforge-app/pr-review-ui/diffAdapter')>()
  return {
    ...actual,
    toGitDiffViewData: vi.fn().mockReturnValue({}),
    isTruncated: vi.fn().mockReturnValue(false),
    getTruncationStats: vi.fn().mockReturnValue(null),
  }
})

vi.mock('@openforge-app/pr-review-ui/diffComments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openforge-app/pr-review-ui/diffComments')>()
  return {
    ...actual,
    buildExtendData: vi.fn(actual.buildExtendData),
  }
})

vi.mock('@openforge-app/pr-review-ui/diffHighlighter', () => ({
  diffHighlighter: mockDiffHighlighter,
}))

vi.mock('@openforge-app/pr-review-ui/useVirtualizer.svelte', () => ({
  createVirtualizer: vi.fn((opts: { getCount: () => number }) => ({
    get virtualItems() {
      const count = opts.getCount()
      return Array.from({ length: count }, (_, i) => ({
        key: i, index: i, start: i * 300, end: (i + 1) * 300, size: 300, lane: 0,
      }))
    },
    totalSize: 0,
    scrollToIndex: vi.fn(),
    measureAction: () => ({ destroy() {} }),
  })),
}))

const mockHighlights = new Map()
Object.defineProperty(globalThis, 'CSS', {
  value: { highlights: mockHighlights },
  writable: true,
  configurable: true,
})

globalThis.Highlight = class MockHighlight {
  ranges: AbstractRange[]
  constructor(...ranges: AbstractRange[]) {
    this.ranges = ranges
  }
} as unknown as typeof Highlight

export { mockDiffHighlighter, mockDiffView }
