import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import DiffViewer from './DiffViewer.svelte'

vi.mock('./useVirtualizer.svelte', () => ({
  createVirtualizer: vi.fn((opts: { getCount: () => number }) => ({
    get virtualItems() {
      return Array.from({ length: opts.getCount() }, (_, index) => ({
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
  })),
}))

vi.mock('./useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn(() => ({
    getDiffFile: () => null,
  })),
}))

const files: PrFileDiff[] = [
  {
    sha: 'abc123',
    filename: 'src/main.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
    changes: 3,
    patch: '@@ -1 +1 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  },
]

describe('DiffViewer accessibility', () => {
  beforeEach(() => {
    // Line wrapping now defaults to on and persists to localStorage; clear it so the
    // toolbar starts from the default in each test.
    localStorage.clear()
  })

  it('names toolbar icon controls and exposes pressed/expanded state', async () => {
    const onToggleFileTree = vi.fn()
    render(DiffViewer, { props: { files, fileTreeVisible: true, onToggleFileTree } })

    const fileTreeButton = screen.getByRole('button', { name: 'Hide file tree' })
    expect(fileTreeButton.getAttribute('aria-expanded')).toBe('true')

    const splitButton = screen.getByRole('button', { name: 'Split diff view' })
    const unifiedButton = screen.getByRole('button', { name: 'Unified diff view' })
    expect(splitButton.getAttribute('aria-pressed')).toBe('true')
    expect(unifiedButton.getAttribute('aria-pressed')).toBe('false')

    await fireEvent.click(unifiedButton)
    expect(screen.getByRole('button', { name: 'Split diff view' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Unified diff view' }).getAttribute('aria-pressed')).toBe('true')

    // Line wrapping defaults to off, so the button starts in the "Enable" (unpressed) state.
    const wrapButton = screen.getByRole('button', { name: 'Enable line wrapping' })
    expect(wrapButton.getAttribute('aria-pressed')).toBe('false')
    await fireEvent.click(wrapButton)
    expect(screen.getByRole('button', { name: 'Disable line wrapping' }).getAttribute('aria-pressed')).toBe('true')

    await fireEvent.click(screen.getByRole('button', { name: 'Search diff' }))
    expect(screen.getByRole('textbox', { name: 'Search diff text' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Previous search match' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next search match' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close diff search' })).toBeTruthy()
  })

  it('Shift+Tab in the diff scroll area requests focus back on the file tree', async () => {
    const onRequestFocusFileTree = vi.fn()
    render(DiffViewer, { props: { files, onRequestFocusFileTree } })

    const scrollArea = screen.getByRole('region', { name: 'Diff scroll area' })

    await fireEvent.keyDown(scrollArea, { key: 'Tab', shiftKey: true })
    expect(onRequestFocusFileTree).toHaveBeenCalledTimes(1)

    // Plain Tab should not request the tree (it moves focus forward as usual).
    await fireEvent.keyDown(scrollArea, { key: 'Tab' })
    expect(onRequestFocusFileTree).toHaveBeenCalledTimes(1)
  })

  it('exposes collapsed file diff state on file header buttons', async () => {
    render(DiffViewer, { props: { files } })

    const collapseButton = screen.getByRole('button', { name: 'Collapse diff for src/main.ts' })
    expect(collapseButton.getAttribute('aria-expanded')).toBe('true')

    await fireEvent.click(collapseButton)

    expect(screen.getByRole('button', { name: 'Expand diff for src/main.ts' }).getAttribute('aria-expanded')).toBe('false')
  })
})
