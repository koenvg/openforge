import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import FileTree from './FileTree.svelte'

const files: PrFileDiff[] = [
  {
    sha: 'abc123',
    filename: 'src/components/Button.svelte',
    status: 'modified',
    additions: 3,
    deletions: 1,
    changes: 4,
    patch: '@@ -1 +1 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  },
]

describe('FileTree accessibility', () => {
  it('exposes expanded directories and selected files through ARIA state', async () => {
    const onSelectFile = vi.fn()
    render(FileTree, { props: { files, onSelectFile } })

    // src/ contains only components/, which contains only the file, so the single-child
    // directory chain is compacted into one "src/components" node (VSCode-style).
    const srcDir = screen.getByRole('treeitem', { name: 'Collapse src/components' })
    expect(srcDir.getAttribute('aria-expanded')).toBe('true')

    await fireEvent.click(srcDir)
    const collapsedSrcDir = screen.getByRole('treeitem', { name: 'Expand src/components' })
    expect(collapsedSrcDir.getAttribute('aria-expanded')).toBe('false')

    await fireEvent.click(collapsedSrcDir)
    const file = screen.getByRole('treeitem', { name: /Select file src\/components\/Button\.svelte/ })
    expect(file.getAttribute('aria-selected')).toBe('false')

    await fireEvent.click(file)

    expect(onSelectFile).toHaveBeenCalledWith('src/components/Button.svelte')
    expect(screen.getByRole('treeitem', { name: /Selected file src\/components\/Button\.svelte/ }).getAttribute('aria-selected')).toBe('true')
  })
})
