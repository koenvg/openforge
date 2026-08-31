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

  it('shows each file pending comment count while expanded and collapsed', async () => {
    const otherFile = { ...files[0], sha: 'def456', filename: 'src/other.ts' }
    const uncommentedFile = { ...files[0], sha: 'ghi789', filename: 'src/uncommented.ts' }
    const pendingComments = [
      { path: 'src/main.ts', line: 1, side: 'RIGHT', body: 'First comment' },
      { path: 'src/main.ts', line: 2, side: 'RIGHT', body: 'Second comment' },
      { path: 'src/other.ts', line: 1, side: 'RIGHT', body: 'Other comment' },
    ]

    render(DiffViewer, {
      props: { files: [files[0], otherFile, uncommentedFile], pendingComments },
    })

    expect(screen.getByRole('button', {
      name: 'Collapse diff for src/uncommented.ts',
    })).toBeTruthy()

    const mainHeader = screen.getByRole('button', {
      name: 'Collapse diff for src/main.ts, 2 pending comments',
    })
    expect(screen.getByTitle('2 pending comments').textContent).toContain('2')
    expect(screen.getByTitle('1 pending comment').textContent).toContain('1')

    await fireEvent.click(mainHeader)

    expect(screen.getByRole('button', {
      name: 'Expand diff for src/main.ts, 2 pending comments',
    })).toBeTruthy()
    expect(screen.getByTitle('2 pending comments').textContent).toContain('2')
  })
  it('announces large change sets and auto-collapses oversized files', () => {
    const largeFiles = Array.from({ length: 12 }, (_, index) => ({
      ...files[0],
      sha: `sha-${index}`,
      filename: `src/large-${index}.ts`,
      additions: 500,
      deletions: 1,
      changes: 501,
    }))

    render(DiffViewer, { props: { files: largeFiles } })

    expect(screen.getByText(/Large diff — 12 files, 6012 total changes\. 12 files auto-collapsed/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Expand diff for src\/large-/ })).toHaveLength(12)
  })
  it('keeps the auto-collapse count unchanged after manual and Reviewed File collapses', async () => {
    const largeDiffFiles = Array.from({ length: 11 }, (_, index) => ({
      ...files[0],
      sha: `sha-${index}`,
      filename: `src/large-diff-${index}.ts`,
      additions: index < 2 ? 501 : 500,
      deletions: 0,
      changes: index < 2 ? 501 : 500,
    }))
    const warningCopy = 'Large diff — 11 files, 5502 total changes. 2 files auto-collapsed for performance.'

    render(DiffViewer, {
      props: {
        files: largeDiffFiles,
        reviewedFileShas: new Map(),
        onToggleFileReviewed: vi.fn(),
      },
    })

    expect(screen.getByText(warningCopy)).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Collapse diff for src/large-diff-2.ts' }))
    expect(screen.getByText(warningCopy)).toBeTruthy()

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Mark src/large-diff-3.ts reviewed' }))
    expect(screen.getByText(warningCopy)).toBeTruthy()
  })

  it('copies the current file path without changing expanded or collapsed state', async () => {
    const onCopyFilePath = vi.fn()
    render(DiffViewer, { props: { files, onCopyFilePath } })

    const copyPathButton = screen.getByRole('button', { name: 'Copy file path: src/main.ts' })
    const pathText = screen.getByText('src/main.ts')
    expect(pathText.tagName).toBe('SPAN')
    expect(pathText.nextElementSibling).toBe(copyPathButton)
    expect(copyPathButton.querySelector('svg')).not.toBeNull()
    const collapseButton = screen.getByRole('button', { name: 'Collapse diff for src/main.ts' })
    expect(collapseButton.getAttribute('aria-expanded')).toBe('true')

    await fireEvent.click(copyPathButton)

    expect(onCopyFilePath).toHaveBeenLastCalledWith('src/main.ts')
    expect(screen.getByRole('button', { name: 'Collapse diff for src/main.ts' }).getAttribute('aria-expanded')).toBe('true')

    await fireEvent.click(collapseButton)
    const expandButton = screen.getByRole('button', { name: 'Expand diff for src/main.ts' })
    expect(expandButton.getAttribute('aria-expanded')).toBe('false')

    await fireEvent.click(screen.getByRole('button', { name: 'Copy file path: src/main.ts' }))

    expect(onCopyFilePath).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Expand diff for src/main.ts' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('copies only the current path for a renamed file', async () => {
    const renamedFile = {
      ...files[0],
      filename: 'src/current.ts',
      previous_filename: 'src/previous.ts',
    }
    const onCopyFilePath = vi.fn()
    render(DiffViewer, { props: { files: [renamedFile], onCopyFilePath } })

    const copyPathButton = screen.getByRole('button', { name: 'Copy file path: src/current.ts' })
    copyPathButton.focus()
    expect(document.activeElement).toBe(copyPathButton)

    await fireEvent.click(copyPathButton)

    expect(onCopyFilePath).toHaveBeenCalledWith('src/current.ts')
    expect(onCopyFilePath).not.toHaveBeenCalledWith('src/previous.ts')
  })
})
