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

describe('FileTree reviewed checkbox', () => {
  it('renders a reviewed checkbox per file when onToggleFileReviewed is provided', () => {
    const filename = 'src/a.ts'
    render(FileTree, {
      props: {
        files: [makeFile(filename)],
        onSelectFile: vi.fn(),
        onToggleFileReviewed: vi.fn(),
      },
    })

    expect(screen.getByRole('checkbox', { name: `Toggle reviewed for ${filename}` })).toBeTruthy()
  })

  it('does not render a reviewed checkbox when onToggleFileReviewed is absent', () => {
    render(FileTree, {
      props: {
        files: [makeFile('src/a.ts')],
        onSelectFile: vi.fn(),
      },
    })

    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('reflects reviewed state from reviewedFileShas', () => {
    const file = makeFile('src/a.ts')
    render(FileTree, {
      props: {
        files: [file],
        onSelectFile: vi.fn(),
        onToggleFileReviewed: vi.fn(),
        reviewedFileShas: new Map([[file.filename, file.sha]]),
      },
    })

    const checkbox = screen.getByRole('checkbox', { name: `Toggle reviewed for ${file.filename}` }) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('calls onToggleFileReviewed with (file, true) when checking an unreviewed file', async () => {
    const file = makeFile('src/a.ts')
    const onToggleFileReviewed = vi.fn()
    render(FileTree, {
      props: {
        files: [file],
        onSelectFile: vi.fn(),
        onToggleFileReviewed,
      },
    })

    const checkbox = screen.getByRole('checkbox', { name: `Toggle reviewed for ${file.filename}` })
    await fireEvent.click(checkbox)

    expect(onToggleFileReviewed).toHaveBeenCalledWith(
      expect.objectContaining({ filename: file.filename }),
      true,
    )
  })

  it('does not select the file when toggling its reviewed checkbox', async () => {
    const file = makeFile('src/a.ts')
    const onSelectFile = vi.fn()
    render(FileTree, {
      props: {
        files: [file],
        onSelectFile,
        onToggleFileReviewed: vi.fn(),
      },
    })

    const checkbox = screen.getByRole('checkbox', { name: `Toggle reviewed for ${file.filename}` })
    await fireEvent.click(checkbox)

    expect(onSelectFile).not.toHaveBeenCalled()
  })
})
