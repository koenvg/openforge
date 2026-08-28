import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lucide/svelte', () => ({
  Archive: vi.fn(() => ({})),
  CircleAlert: vi.fn(() => ({})),
  FileQuestion: vi.fn(() => ({})),
  FileText: vi.fn(() => ({})),
  Folder: vi.fn(() => ({})),
  FolderOpen: vi.fn(() => ({})),
  TriangleAlert: vi.fn(() => ({})),
}))

import FileTreeStates from './FileTreeStates.svelte'

const fileEntry = {
  name: 'README.md',
  path: 'README.md',
  isDir: false,
  size: 10,
  modifiedAt: null,
}

function makeModel() {
  return {
    directoryError: { path: 'src', message: 'Permission denied' },
    failedRevealPath: 'src/private.ts',
    rootEntries: [fileEntry],
    flatEntries: [fileEntry],
    expandedPaths: new Set<string>(),
    selectedPath: null,
    treeScrollTop: 0,
    treeFocusRequest: null,
    search: {
      active: false,
      loading: false,
      error: null,
      entries: [],
      expandedDirs: new Set<string>(),
      limitReached: false,
      limit: 50,
    },
  }
}

function makeActions() {
  return {
    onRetrySearch: vi.fn(),
    onRetryDirectoryLoad: vi.fn(),
    onRetryRevealPath: vi.fn(),
    onToggleDir: vi.fn(async () => true),
    onSelectFile: vi.fn(async () => true),
    onTreeScrollTopChange: vi.fn(),
  }
}

afterEach(cleanup)

describe('FileTreeStates', () => {
  it('keeps directory and reveal failures beside the tree with focused retry actions', async () => {
    const actions = makeActions()

    render(FileTreeStates, { props: { model: makeModel(), actions } })

    expect(screen.getByText('Permission denied')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading src directory' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Retry revealing src/private.ts' }))

    expect(actions.onRetryDirectoryLoad).toHaveBeenCalledWith('src')
    expect(actions.onRetryRevealPath).toHaveBeenCalledWith('src/private.ts')
    expect(screen.getByText('README.md')).toBeTruthy()
  })
})
