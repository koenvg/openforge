import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import FileTree from './FileTree.svelte'

function makeFile(filename: string, overrides: Partial<PrFileDiff> = {}): PrFileDiff {
  return {
    sha: `sha-${filename}`,
    filename,
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: '@@ -1 +1 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    ...overrides,
  }
}

describe('FileTree shallow path groups', () => {
  it('groups a deeply nested file under its full parent path', () => {
    const filename = 'libs/bound-shared/forge/src/widgets/ai-generated/AssetsByStatus.tsx'
    render(FileTree, { props: { files: [makeFile(filename)], onSelectFile: vi.fn() } })

    expect(screen.getByRole('treeitem', {
      name: 'Collapse libs/bound-shared/forge/src/widgets/ai-generated',
    })).toBeTruthy()
    expect(screen.queryByRole('treeitem', { name: 'Collapse libs' })).toBeNull()
    expect(screen.getByRole('treeitem', { name: `Select file ${filename}` })).toBeTruthy()
  })

  it('renders sibling parent paths as separate shallow groups', () => {
    render(FileTree, {
      props: {
        files: [makeFile('src/deep/one/x.ts'), makeFile('src/deep/two/y.ts')],
        onSelectFile: vi.fn(),
      },
    })

    expect(screen.getByRole('treeitem', { name: 'Collapse src/deep/one' })).toBeTruthy()
    expect(screen.getByRole('treeitem', { name: 'Collapse src/deep/two' })).toBeTruthy()
    expect(screen.queryByRole('treeitem', { name: 'Collapse src/deep' })).toBeNull()
  })

  it('keeps parent and nested parent paths as separate groups', () => {
    render(FileTree, {
      props: {
        files: [makeFile('pkg/readme.md'), makeFile('pkg/sub/deep.ts')],
        onSelectFile: vi.fn(),
      },
    })

    expect(screen.getByRole('treeitem', { name: 'Collapse pkg' })).toBeTruthy()
    expect(screen.getByRole('treeitem', { name: 'Collapse pkg/sub' })).toBeTruthy()
  })

  it('selects the correct file within a shallow group', async () => {
    const onSelectFile = vi.fn()
    const filename = 'a/b/c/d/File.svelte'
    render(FileTree, { props: { files: [makeFile(filename)], onSelectFile } })

    await fireEvent.click(screen.getByRole('treeitem', { name: `Select file ${filename}` }))
    expect(onSelectFile).toHaveBeenCalledWith(filename)
  })

  it('collapses one path group without hiding sibling groups', async () => {
    const first = 'a/b/c/File.svelte'
    const second = 'a/b/d/Other.svelte'
    render(FileTree, { props: { files: [makeFile(first), makeFile(second)], onSelectFile: vi.fn() } })

    await fireEvent.click(screen.getByRole('treeitem', { name: 'Collapse a/b/c' }))

    expect(screen.queryByRole('treeitem', { name: `Select file ${first}` })).toBeNull()
    expect(screen.getByRole('treeitem', { name: `Select file ${second}` })).toBeTruthy()
  })
})

describe('FileTree visual metadata', () => {
  it('renders a compact file-status badge', () => {
    render(FileTree, { props: { files: [makeFile('src/foo.ts')], onSelectFile: vi.fn() } })
    expect(screen.getByLabelText('Modified').textContent).toBe('M')
  })

  it('renders a folder icon for path groups', () => {
    render(FileTree, { props: { files: [makeFile('src/deep/foo.ts')], onSelectFile: vi.fn() } })
    expect(screen.getByTestId('file-tree-folder-icon')).toBeTruthy()
  })
})

describe('FileTree non-application files toggle', () => {
  it('renders the toggle when a handler and a non-zero count are provided', () => {
    const onToggleNonApplicationFiles = vi.fn()
    render(FileTree, {
      props: {
        files: [makeFile('src/app.ts')],
        onSelectFile: vi.fn(),
        includeNonApplicationFiles: true,
        nonApplicationFileCount: 2,
        onToggleNonApplicationFiles,
      },
    })

    expect(screen.getByRole('checkbox', { name: /Also include non-application files/i })).toBeTruthy()
  })

  it('reports the new state when the toggle is deselected', async () => {
    const onToggleNonApplicationFiles = vi.fn()
    render(FileTree, {
      props: {
        files: [makeFile('src/app.ts')],
        onSelectFile: vi.fn(),
        includeNonApplicationFiles: true,
        nonApplicationFileCount: 2,
        onToggleNonApplicationFiles,
      },
    })

    await fireEvent.click(screen.getByRole('checkbox', { name: /Also include non-application files/i }))
    expect(onToggleNonApplicationFiles).toHaveBeenCalledWith(false)
  })

  it('omits the toggle when there are no non-application files', () => {
    render(FileTree, {
      props: {
        files: [makeFile('src/app.ts')],
        onSelectFile: vi.fn(),
        nonApplicationFileCount: 0,
        onToggleNonApplicationFiles: vi.fn(),
      },
    })

    expect(screen.queryByRole('checkbox', { name: /Also include non-application files/i })).toBeNull()
  })

  it('omits the toggle when no handler is provided', () => {
    render(FileTree, {
      props: {
        files: [makeFile('src/app.ts')],
        onSelectFile: vi.fn(),
        nonApplicationFileCount: 3,
      },
    })

    expect(screen.queryByRole('checkbox', { name: /Also include non-application files/i })).toBeNull()
  })
})

describe('FileTree review filtering', () => {
  it('filters changed files by path while keeping matching file statistics visible', async () => {
    render(FileTree, {
      props: {
        files: [
          makeFile('src/components/ReviewPanel.svelte', { additions: 12, deletions: 4 }),
          makeFile('src/lib/taskState.ts', { additions: 3, deletions: 1 }),
        ],
        onSelectFile: vi.fn(),
      },
    })

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter changed files' }), {
      target: { value: 'reviewpanel' },
    })

    expect(screen.getByRole('treeitem', { name: 'Select file src/components/ReviewPanel.svelte' })).toBeTruthy()
    expect(screen.queryByRole('treeitem', { name: 'Select file src/lib/taskState.ts' })).toBeNull()
    expect(screen.getByText('+12')).toBeTruthy()
    expect(screen.getByText('−4')).toBeTruthy()
  })
})
