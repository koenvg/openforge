import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@openforge/plugin-sdk/domain'
import ProjectFileTree from './ProjectFileTree.svelte'

function makeEntry(overrides: Partial<FileEntry>): FileEntry {
  return {
    name: 'entry',
    path: 'entry',
    isDir: false,
    size: 128,
    modifiedAt: null,
    ...overrides,
  }
}

function renderTree(props: Partial<{
  entries: FileEntry[]
  expandedDirs: Set<string>
  selectedPath: string | null
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
}> = {}) {
  return render(ProjectFileTree, {
    props: {
      entries: [],
      expandedDirs: new Set<string>(),
      selectedPath: null,
      onToggleDir: () => {},
      onSelectFile: () => {},
      ...props,
    },
  })
}

describe('plugin ProjectFileTree accessibility', () => {
  it('exposes collapsed and expanded directory state', async () => {
    const { rerender } = renderTree({
      entries: [makeEntry({ name: 'src', path: 'src', isDir: true, size: null })],
      expandedDirs: new Set<string>(),
    })

    expect(screen.getByRole('button', { name: /src\// }).getAttribute('aria-expanded')).toBe('false')

    await rerender({
      entries: [makeEntry({ name: 'src', path: 'src', isDir: true, size: null })],
      expandedDirs: new Set<string>(['src']),
      selectedPath: null,
      onToggleDir: () => {},
      onSelectFile: () => {},
    })

    expect(screen.getByRole('button', { name: /src\// }).getAttribute('aria-expanded')).toBe('true')
  })

  it('marks only the selected file as current', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'index.ts', path: 'src/index.ts', isDir: false }),
        makeEntry({ name: 'utils.ts', path: 'src/lib/utils.ts', isDir: false }),
      ],
      selectedPath: 'src/lib/utils.ts',
    })

    expect(screen.getByRole('button', { name: /index\.ts/ }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: /utils\.ts/ }).getAttribute('aria-current')).toBe('true')
  })
})
