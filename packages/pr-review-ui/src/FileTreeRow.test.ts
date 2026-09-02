import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import FileTreeRow from './FileTreeRow.svelte'
import type { FileTreeNode } from './fileTreeModel'

function makeFile(filename: string): PrFileDiff {
  return {
    sha: `sha-${filename}`,
    filename,
    status: 'modified',
    additions: 2,
    deletions: 1,
    changes: 3,
    patch: '@@ -1 +1 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  }
}

describe('FileTreeRow', () => {
  it('presents a compact directory row and reports expansion requests', async () => {
    const onToggleDirectory = vi.fn()
    const node: FileTreeNode = {
      name: 'src/lib',
      fullPath: 'src/lib',
      isDir: true,
      children: new Map(),
    }

    render(FileTreeRow, {
      props: {
        node,
        depth: 1,
        expanded: false,
        onToggleDirectory,
        onSelectFile: vi.fn(),
        onToggleFileReviewed: vi.fn(),
      },
    })

    const row = screen.getByRole('treeitem', { name: 'Expand src/lib' })
    expect(row.getAttribute('aria-level')).toBe('2')
    expect(screen.getByTitle('src/lib')).toBeTruthy()

    await fireEvent.click(row)
    expect(onToggleDirectory).toHaveBeenCalledWith('src/lib')
  })

  it('presents file review metadata and reports selection and review changes', async () => {
    const file = makeFile('src/lib/a.ts')
    const onSelectFile = vi.fn()
    const onToggleFileReviewed = vi.fn()
    const node: FileTreeNode = {
      name: 'a.ts',
      fullPath: file.filename,
      isDir: false,
      children: new Map(),
      file,
    }

    render(FileTreeRow, {
      props: {
        node,
        depth: 2,
        reviewed: true,
        selected: true,
        canToggleReviewed: true,
        onToggleDirectory: vi.fn(),
        onSelectFile,
        onToggleFileReviewed,
      },
    })

    await fireEvent.click(screen.getByRole('treeitem', {
      name: 'Selected file src/lib/a.ts (reviewed)',
    }))
    expect(onSelectFile).toHaveBeenCalledWith(file)
    expect(screen.getByLabelText('Modified').textContent).toBe('M')
    expect(screen.getByLabelText('2 additions and 1 deletions')).toBeTruthy()

    const reviewCheckbox = screen.getByRole('checkbox', {
      name: 'Toggle reviewed for src/lib/a.ts',
    })
    expect(reviewCheckbox.parentElement?.getAttribute('data-size')).toBe('xs')

    await fireEvent.click(reviewCheckbox)
    expect(onToggleFileReviewed).toHaveBeenCalledWith(file, false)
  })
})
