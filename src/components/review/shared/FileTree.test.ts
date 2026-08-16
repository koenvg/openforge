import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import FileTree from './FileTree.svelte'
import type { PrFileDiff } from '../../../lib/types'

const baseFiles: PrFileDiff[] = [
  {
    sha: 'a1',
    filename: 'src/lib/auth.ts',
    status: 'modified',
    additions: 10,
    deletions: 5,
    changes: 15,
    patch: '@@ -1,3 +1,5 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  },
  {
    sha: 'a2',
    filename: 'src/lib/utils.ts',
    status: 'added',
    additions: 20,
    deletions: 0,
    changes: 20,
    patch: '@@ -0,0 +1,20 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  },
  {
    sha: 'a3',
    filename: 'README.md',
    status: 'modified',
    additions: 3,
    deletions: 1,
    changes: 4,
    patch: '@@ -1,5 +1,7 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  },
]

describe('FileTree', () => {
  it('renders file count in header', () => {
    const onSelectFile = () => {}
    render(FileTree, { props: { files: baseFiles, onSelectFile } })
    expect(screen.getByText('3 files')).toBeTruthy()
  })

  it('renders total additions count in header', () => {
    const onSelectFile = () => {}
    render(FileTree, { props: { files: baseFiles, onSelectFile } })
    expect(screen.getByText('+33')).toBeTruthy()
  })

  it('renders total deletions count in header', () => {
    const onSelectFile = () => {}
    render(FileTree, { props: { files: baseFiles, onSelectFile } })
    expect(screen.getByText('−6')).toBeTruthy()
  })

  it('renders file names', () => {
    const onSelectFile = () => {}
    render(FileTree, { props: { files: baseFiles, onSelectFile } })
    expect(screen.getByText('auth.ts')).toBeTruthy()
    expect(screen.getByText('utils.ts')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it.each([
    ['modified', 'M'],
    ['added', 'A'],
    ['removed', 'D'],
    ['renamed', 'R'],
  ] as const)('shows a status badge for %s files', (status, badge) => {
    const file: PrFileDiff = {
      sha: `sha-${status}`,
      filename: `${status}.ts`,
      status,
      additions: status === 'added' ? 1 : 0,
      deletions: status === 'removed' ? 1 : 0,
      changes: 1,
      patch: '@@ -1,1 +1,1 @@',
      previous_filename: status === 'renamed' ? 'old.ts' : null,
      is_truncated: false,
      patch_line_count: null,
    }

    render(FileTree, { props: { files: [file], onSelectFile: () => {} } })

    expect(screen.getByText(badge)).toBeTruthy()
  })

  it('calls onSelectFile when a file is clicked', async () => {
    let selectedFilename = ''
    const onSelectFile = (filename: string) => {
      selectedFilename = filename
    }
    const singleFile: PrFileDiff = {
      sha: 'a1',
      filename: 'test.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      changes: 2,
      patch: '@@ -1,1 +1,1 @@',
      previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    }
    render(FileTree, { props: { files: [singleFile], onSelectFile } })
    const fileButton = screen.getByText('test.ts')
    await fireEvent.click(fileButton)
    expect(selectedFilename).toBe('test.ts')
  })

  it('groups files under their full immediate parent path', () => {
    const onSelectFile = () => {}
    const nestedFiles: PrFileDiff[] = [
      {
        sha: 'a1',
        filename: 'src/components/Button.svelte',
        status: 'modified',
        additions: 5,
        deletions: 2,
        changes: 7,
        patch: '@@ -1,3 +1,5 @@',
        previous_filename: null,
        is_truncated: false,
        patch_line_count: null,
      },
    ]
    render(FileTree, { props: { files: nestedFiles, onSelectFile } })

    expect(screen.getByText('src/components')).toBeTruthy()
    expect(screen.getByText('Button.svelte')).toBeTruthy()
    expect(screen.queryByText('src')).toBeNull()
    expect(screen.queryByText('components')).toBeNull()
  })

  it('directories are collapsed when clicked', async () => {
    const onSelectFile = () => {}
    const nestedFiles: PrFileDiff[] = [
      {
        sha: 'a1',
        filename: 'src/lib/test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: '@@ -1,1 +1,1 @@',
        previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
      },
    ]
    render(FileTree, { props: { files: nestedFiles, onSelectFile } })
    const dir = screen.getByText('src/lib')
    expect(screen.getByText('test.ts')).toBeTruthy()
    await fireEvent.click(dir)
    expect(screen.queryByText('test.ts')).toBeNull()
  })

  it('directories are expanded when clicked again', async () => {
    const onSelectFile = () => {}
    const nestedFiles: PrFileDiff[] = [
      {
        sha: 'a1',
        filename: 'src/lib/test.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: '@@ -1,1 +1,1 @@',
        previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
      },
    ]
    render(FileTree, { props: { files: nestedFiles, onSelectFile } })
    const dir = screen.getByText('src/lib')
    await fireEvent.click(dir)
    expect(screen.queryByText('test.ts')).toBeNull()
    await fireEvent.click(dir)
    expect(screen.getByText('test.ts')).toBeTruthy()
  })

  it('shows file stats for each file', () => {
    const onSelectFile = () => {}
    const fileWithStats: PrFileDiff = {
      sha: 'a1',
      filename: 'test.ts',
      status: 'modified',
      additions: 15,
      deletions: 8,
      changes: 23,
      patch: '@@ -1,10 +1,17 @@',
      previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    }
    render(FileTree, { props: { files: [fileWithStats], onSelectFile } })
    expect(screen.getAllByText('+15').length).toBeGreaterThan(0)
    expect(screen.getAllByText('−8').length).toBeGreaterThan(0)
  })

  it('keeps reviewed files in their original tree location without a reviewed group or checkbox', () => {
    const onSelectFile = () => {}
    render(FileTree, {
      props: {
        files: baseFiles,
        onSelectFile,
        reviewedFileShas: new Map([['src/lib/auth.ts', 'a1']]),
      },
    })

    expect(screen.getByText('auth.ts')).toBeTruthy()
    expect(screen.getByText('utils.ts')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reviewed files (1)' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Mark src/lib/auth.ts reviewed' })).toBeNull()
    expect(screen.queryByText('1 reviewed hidden')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show reviewed files' })).toBeNull()
  })

  it('shows a reviewed file again when its sha changes', () => {
    const onSelectFile = () => {}
    render(FileTree, {
      props: {
        files: [{ ...baseFiles[0], sha: 'new-sha' }],
        onSelectFile,
        reviewedFileShas: new Map([['src/lib/auth.ts', 'a1']]),
      },
    })

    expect(screen.getByText('auth.ts')).toBeTruthy()
    expect(screen.queryByText('1 reviewed hidden')).toBeNull()
  })

  it('keeps reviewed file rows navigable', async () => {
    let selected: string | null = null
    render(FileTree, {
      props: {
        files: [baseFiles[0]],
        onSelectFile: (filename: string) => {
          selected = filename
        },
        reviewedFileShas: new Map([['src/lib/auth.ts', 'a1']]),
      },
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /auth\.ts/ }))

    expect(selected).toBe('src/lib/auth.ts')
    expect(screen.queryByRole('checkbox', { name: 'Mark src/lib/auth.ts reviewed' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reviewed files (1)' })).toBeNull()
  })
})
