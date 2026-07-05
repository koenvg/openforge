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

describe('FileTree compact folders', () => {
  it('collapses a chain of single-child directories into one node (VSCode-style)', () => {
    const filename = 'libs/bound-shared/forge/src/widgets/ai-generated/AssetsByStatus.tsx'
    render(FileTree, { props: { files: [makeFile(filename)], onSelectFile: vi.fn() } })

    // The whole single-child directory chain renders as a single directory node.
    const dir = screen.getByRole('treeitem', {
      name: 'Collapse libs/bound-shared/forge/src/widgets/ai-generated',
    })
    expect(dir).toBeTruthy()

    // No intermediate directory node is rendered on its own.
    expect(screen.queryByRole('treeitem', { name: 'Collapse libs' })).toBeNull()
    expect(screen.queryByRole('treeitem', { name: 'Collapse libs/bound-shared' })).toBeNull()

    // The file itself is still present as a leaf.
    expect(screen.getByRole('treeitem', { name: `Select file ${filename}` })).toBeTruthy()
  })

  it('stops compacting at a branch point and resumes below it', () => {
    render(FileTree, {
      props: {
        files: [makeFile('src/deep/one/x.ts'), makeFile('src/deep/two/y.ts')],
        onSelectFile: vi.fn(),
      },
    })

    // src/ has a single child (deep/), so they compact together...
    expect(screen.getByRole('treeitem', { name: 'Collapse src/deep' })).toBeTruthy()
    // ...but deep/ branches into one/ and two/, which stay as separate nodes.
    expect(screen.getByRole('treeitem', { name: 'Collapse src/deep/one' })).toBeTruthy()
    expect(screen.getByRole('treeitem', { name: 'Collapse src/deep/two' })).toBeTruthy()
    expect(screen.queryByRole('treeitem', { name: 'Collapse src' })).toBeNull()
  })

  it('does not compact directories that contain files alongside a single subdirectory', () => {
    render(FileTree, {
      props: {
        files: [makeFile('pkg/readme.md'), makeFile('pkg/sub/deep.ts')],
        onSelectFile: vi.fn(),
      },
    })

    // pkg/ holds a file and a directory, so it is not folded into sub/.
    expect(screen.getByRole('treeitem', { name: 'Collapse pkg' })).toBeTruthy()
    expect(screen.getByRole('treeitem', { name: 'Collapse pkg/sub' })).toBeTruthy()
  })

  it('selects the correct file when clicking a leaf inside a compacted chain', async () => {
    const onSelectFile = vi.fn()
    const filename = 'a/b/c/d/File.svelte'
    render(FileTree, { props: { files: [makeFile(filename)], onSelectFile } })

    await fireEvent.click(screen.getByRole('treeitem', { name: `Select file ${filename}` }))
    expect(onSelectFile).toHaveBeenCalledWith(filename)
  })

  it('toggles the compacted directory as a single expand/collapse unit', async () => {
    const filename = 'a/b/c/File.svelte'
    render(FileTree, { props: { files: [makeFile(filename)], onSelectFile: vi.fn() } })

    const dir = screen.getByRole('treeitem', { name: 'Collapse a/b/c' })
    expect(dir.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('treeitem', { name: `Select file ${filename}` })).toBeTruthy()

    await fireEvent.click(dir)

    const collapsed = screen.getByRole('treeitem', { name: 'Expand a/b/c' })
    expect(collapsed.getAttribute('aria-expanded')).toBe('false')
    // Collapsing the compacted node hides its file leaf.
    expect(screen.queryByRole('treeitem', { name: `Select file ${filename}` })).toBeNull()
  })
})
