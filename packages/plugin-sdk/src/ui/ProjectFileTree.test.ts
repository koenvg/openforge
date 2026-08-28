import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '../domain'
import ProjectFileTree from '@openforge-app/plugin-sdk/ui/ProjectFileTree.svelte'

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

const defaultProps = {
  entries: [] as FileEntry[],
  expandedDirs: new Set<string>(),
  selectedPath: null as string | null,
  onToggleDir: (_path: string) => {},
  onSelectFile: (_path: string) => {},
}

function renderTree(props: Partial<typeof defaultProps & {
  initialScrollTop: number
  onScrollTopChange: (scrollTop: number) => void
  focusSelectedRequest: number | null
}> = {}) {
  return render(ProjectFileTree, { props: { ...defaultProps, ...props } })
}

describe('plugin-sdk ProjectFileTree', () => {
  it('renders the expanded hierarchy and forwards directory and file activation', async () => {
    const onToggleDir = vi.fn()
    const onSelectFile = vi.fn()

    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'main.ts', path: 'src/main.ts' }),
        makeEntry({ name: 'README.md', path: 'README.md', size: 1536 }),
      ],
      expandedDirs: new Set(['src']),
      selectedPath: 'src/main.ts',
      onToggleDir,
      onSelectFile,
    })

    const tree = screen.getByRole('tree', { name: 'Project files' })
    const src = within(tree).getByRole('treeitem', { name: /src\// })
    const main = within(tree).getByRole('treeitem', { name: /main\.ts/ })

    expect(src.getAttribute('aria-expanded')).toBe('true')
    expect(main.getAttribute('aria-level')).toBe('2')
    expect(main.getAttribute('aria-selected')).toBe('true')
    expect(within(src).getByRole('group').contains(main)).toBe(true)

    await fireEvent.click(src)
    await fireEvent.click(main)

    expect(onToggleDir).toHaveBeenCalledWith('src')
    expect(onSelectFile).toHaveBeenCalledWith('src/main.ts')
  })

  it('supports roving keyboard focus across visible entries', async () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'main.ts', path: 'src/main.ts' }),
        makeEntry({ name: 'README.md', path: 'README.md' }),
      ],
      expandedDirs: new Set(['src']),
    })

    const src = screen.getByRole('treeitem', { name: /src\// }) as HTMLElement
    const main = screen.getByRole('treeitem', { name: /main\.ts/ }) as HTMLElement
    const readme = screen.getByRole('treeitem', { name: /README\.md/ }) as HTMLElement

    expect(src.tabIndex).toBe(0)
    await fireEvent.keyDown(src, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(main)
    await fireEvent.keyDown(main, { key: 'End' })
    expect(document.activeElement).toBe(readme)
  })

  it('restores and reports the tree scroll position', async () => {
    const onScrollTopChange = vi.fn()
    renderTree({
      entries: [makeEntry({ name: 'README.md', path: 'README.md' })],
      initialScrollTop: 42,
      onScrollTopChange,
    })

    const tree = screen.getByRole('tree', { name: 'Project files' }) as HTMLDivElement
    expect(tree.scrollTop).toBe(42)

    tree.scrollTop = 84
    await fireEvent.scroll(tree)
    expect(onScrollTopChange).toHaveBeenCalledWith(84)
  })

  it('focuses the selected visible file once for each new focus request', async () => {
    const entries = [
      makeEntry({ name: 'index.ts', path: 'src/index.ts' }),
      makeEntry({ name: 'utils.ts', path: 'src/utils.ts' }),
    ]
    const props = {
      ...defaultProps,
      entries,
      selectedPath: 'src/utils.ts',
      focusSelectedRequest: null,
    }
    const { rerender } = render(ProjectFileTree, { props })
    const outsideButton = document.body.appendChild(document.createElement('button'))

    try {
      outsideButton.focus()
      await rerender({ ...props, focusSelectedRequest: 1 })
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /utils\.ts/ })))

      outsideButton.focus()
      await rerender({ ...props, focusSelectedRequest: 1 })
      expect(document.activeElement).toBe(outsideButton)

      await rerender({ ...props, focusSelectedRequest: 2 })
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /utils\.ts/ })))
    } finally {
      outsideButton.remove()
    }
  })
})
