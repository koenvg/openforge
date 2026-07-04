import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
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

describe('FileTree keyboard navigation', () => {
  it('ArrowDown selects the next visible file', async () => {
    const onSelectFile = vi.fn()
    render(FileTree, {
      props: { files: [makeFile('src/a.ts'), makeFile('src/b.ts')], onSelectFile },
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: 'Select file src/a.ts' }))
    onSelectFile.mockClear()

    await fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown' })

    expect(onSelectFile).toHaveBeenCalledWith('src/b.ts')
    expect(
      screen.getByRole('treeitem', { name: 'Selected file src/b.ts' }).getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('ArrowUp selects the previous visible file', async () => {
    const onSelectFile = vi.fn()
    render(FileTree, {
      props: { files: [makeFile('src/a.ts'), makeFile('src/b.ts')], onSelectFile },
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: 'Select file src/b.ts' }))
    onSelectFile.mockClear()

    await fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowUp' })

    expect(onSelectFile).toHaveBeenCalledWith('src/a.ts')
  })

  it('ArrowDown with no selection selects the first file', async () => {
    const onSelectFile = vi.fn()
    render(FileTree, {
      props: { files: [makeFile('src/a.ts'), makeFile('src/b.ts')], onSelectFile },
    })

    await fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown' })

    expect(onSelectFile).toHaveBeenCalledWith('src/a.ts')
  })

  it("ArrowLeft collapses and ArrowRight expands the selected file's parent folder", async () => {
    const onSelectFile = vi.fn()
    render(FileTree, { props: { files: [makeFile('src/a.ts')], onSelectFile } })

    await fireEvent.click(screen.getByRole('treeitem', { name: 'Select file src/a.ts' }))
    const tree = screen.getByRole('tree')

    await fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    expect(screen.getByRole('treeitem', { name: 'Expand src' })).toBeTruthy()
    expect(screen.queryByRole('treeitem', { name: /file src\/a\.ts/ })).toBeNull()

    await fireEvent.keyDown(tree, { key: 'ArrowRight' })
    expect(screen.getByRole('treeitem', { name: 'Collapse src' })).toBeTruthy()
    expect(screen.getByRole('treeitem', { name: 'Selected file src/a.ts' })).toBeTruthy()
  })

  it('keeps focus in the tree (and navigation working) after ArrowLeft collapses the folder', async () => {
    const onSelectFile = vi.fn()
    render(FileTree, {
      props: { files: [makeFile('a/x.ts'), makeFile('b/y.ts')], onSelectFile },
    })

    const fileButton = screen.getByRole('treeitem', { name: 'Select file a/x.ts' })
    await fireEvent.click(fileButton)
    fileButton.focus()
    const tree = screen.getByRole('tree')

    // Collapsing a/ removes the focused a/x.ts row from the DOM.
    await fireEvent.keyDown(tree, { key: 'ArrowLeft' })
    await waitFor(() => expect(document.activeElement).toBe(tree))

    // Navigation still works: a/x.ts is hidden, so ArrowDown lands on the first visible file.
    onSelectFile.mockClear()
    await fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(onSelectFile).toHaveBeenCalledWith('b/y.ts')
  })

  it('ArrowDown skips files inside collapsed folders', async () => {
    const onSelectFile = vi.fn()
    render(FileTree, {
      props: { files: [makeFile('a/x.ts'), makeFile('b/y.ts')], onSelectFile },
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: 'Collapse b' }))
    await fireEvent.click(screen.getByRole('treeitem', { name: 'Select file a/x.ts' }))
    onSelectFile.mockClear()

    await fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown' })

    expect(onSelectFile).not.toHaveBeenCalledWith('b/y.ts')
  })
})
