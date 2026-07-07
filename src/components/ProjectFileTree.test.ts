import { render, screen, fireEvent, within } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import ProjectFileTree from './ProjectFileTree.svelte'
import type { FileEntry } from '../lib/types'

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
  initialScrollTop: number
  onScrollTopChange: (scrollTop: number) => void
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

describe('ProjectFileTree', () => {
  it('renders directory and file entries', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'README.md', path: 'README.md', isDir: false, size: 256 }),
      ],
    })

    expect(screen.getByText('src/')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('exposes the file list as a named tree with treeitems', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'README.md', path: 'README.md', isDir: false, size: 1536 }),
      ],
    })

    expect(screen.getByRole('tree', { name: 'Project files' })).toBeTruthy()
    expect(screen.getByRole('treeitem', { name: /src\// }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('treeitem', { name: /README\.md.*1\.5 KB/ })).toBeTruthy()
  })

  it('clicking a directory calls onToggleDir', async () => {
    const onToggleDir = vi.fn()
    renderTree({
      entries: [makeEntry({ name: 'src', path: 'src', isDir: true, size: null })],
      onToggleDir,
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /src\// }))

    expect(onToggleDir).toHaveBeenCalledWith('src')
    expect(onToggleDir).toHaveBeenCalledOnce()
  })

  it('clicking a file calls onSelectFile', async () => {
    const onSelectFile = vi.fn()
    renderTree({
      entries: [makeEntry({ name: 'README.md', path: 'README.md', isDir: false })],
      onSelectFile,
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /README.md/ }))

    expect(onSelectFile).toHaveBeenCalledWith('README.md')
    expect(onSelectFile).toHaveBeenCalledOnce()
  })

  it('marks the selected file as current for assistive technology', () => {
    renderTree({
      entries: [makeEntry({ name: 'README.md', path: 'README.md', isDir: false })],
      selectedPath: 'README.md',
    })

    const selected = screen.getByRole('treeitem', { name: /README\.md/ })
    expect(selected.getAttribute('aria-current')).toBe('true')
    expect(selected.getAttribute('aria-selected')).toBe('true')
  })

  it('preserves the incoming entry order', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'z-file.ts', path: 'z-file.ts', isDir: false }),
        makeEntry({ name: 'a-dir', path: 'a-dir', isDir: true, size: null }),
      ],
    })

    const labels = screen.getAllByTestId('entry-label').map((node) => node.textContent)
    expect(labels).toEqual(['z-file.ts', 'a-dir/'])
  })

  it('keeps nested folders and files grouped beneath their parent order', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'lib', path: 'src/lib', isDir: true, size: null }),
        makeEntry({ name: 'utils.ts', path: 'src/lib/utils.ts', isDir: false }),
        makeEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false }),
        makeEntry({ name: 'README.md', path: 'README.md', isDir: false }),
      ],
      expandedDirs: new Set<string>(['src', 'src/lib']),
    })

    const labels = screen.getAllByTestId('entry-label').map((node) => node.textContent)
    expect(labels).toEqual(['src/', 'lib/', 'utils.ts', 'main.ts', 'README.md'])

    const src = screen.getByRole('treeitem', { name: /src\// })
    const srcGroup = within(src).getAllByRole('group')[0] as HTMLElement
    expect(src.getAttribute('aria-level')).toBe('1')
    expect(src.getAttribute('aria-setsize')).toBe('2')
    expect(src.getAttribute('aria-posinset')).toBe('1')
    expect(within(srcGroup).getByRole('treeitem', { name: /lib\// }).getAttribute('aria-level')).toBe('2')
    expect(screen.getByRole('treeitem', { name: /utils\.ts/ }).getAttribute('aria-level')).toBe('3')
  })

  it('does not expose child groups for collapsed directories', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false }),
      ],
      expandedDirs: new Set<string>(),
    })

    const src = screen.getByRole('treeitem', { name: /src\// })
    expect(within(src).queryByRole('group')).toBeNull()
    expect(screen.queryByRole('treeitem', { name: /main\.ts/ })).toBeNull()
  })

  it('shows no entry rows for empty entries', () => {
    renderTree({ entries: [] })
    expect(screen.queryAllByTestId('tree-entry')).toHaveLength(0)
  })

  it('exposes expanded and collapsed directory state', () => {
    const { rerender } = renderTree({
      entries: [makeEntry({ name: 'src', path: 'src', isDir: true, size: null })],
      expandedDirs: new Set<string>(),
    })

    expect(screen.getByRole('treeitem', { name: /src\// }).getAttribute('aria-expanded')).toBe('false')

    rerender({
      entries: [makeEntry({ name: 'src', path: 'src', isDir: true, size: null })],
      expandedDirs: new Set<string>(['src']),
      selectedPath: null,
      onToggleDir: () => {},
      onSelectFile: () => {},
    })

    expect(screen.getByRole('treeitem', { name: /src\// }).getAttribute('aria-expanded')).toBe('true')
  })

  it('selects nested files using their full paths', async () => {
    const onSelectFile = vi.fn()
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'index.ts', path: 'src/index.ts', isDir: false }),
        makeEntry({ name: 'lib', path: 'src/lib', isDir: true, size: null }),
        makeEntry({ name: 'utils.ts', path: 'src/lib/utils.ts', isDir: false }),
      ],
      expandedDirs: new Set<string>(['src', 'src/lib']),
      onSelectFile,
    })

    await fireEvent.click(screen.getByRole('treeitem', { name: /index\.ts/ }))
    await fireEvent.click(screen.getByRole('treeitem', { name: /utils\.ts/ }))

    expect(onSelectFile).toHaveBeenNthCalledWith(1, 'src/index.ts')
    expect(onSelectFile).toHaveBeenNthCalledWith(2, 'src/lib/utils.ts')
  })

  it('uses roving tabindex and arrow key navigation across visible treeitems', async () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false }),
        makeEntry({ name: 'README.md', path: 'README.md', isDir: false }),
      ],
      expandedDirs: new Set<string>(['src']),
    })

    const src = screen.getByRole('treeitem', { name: /src\// }) as HTMLElement
    const main = screen.getByRole('treeitem', { name: /main\.ts/ }) as HTMLElement
    const readme = screen.getByRole('treeitem', { name: /README\.md/ }) as HTMLElement

    expect(src.tabIndex).toBe(0)
    expect(main.tabIndex).toBe(-1)
    expect(readme.tabIndex).toBe(-1)

    await fireEvent.keyDown(src, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(main)
    expect(main.tabIndex).toBe(0)
    expect(src.tabIndex).toBe(-1)

    await fireEvent.keyDown(main, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(src)

    await fireEvent.keyDown(src, { key: 'ArrowDown' })
    await fireEvent.keyDown(main, { key: 'End' })
    expect(document.activeElement).toBe(readme)

    await fireEvent.keyDown(readme, { key: 'Home' })
    expect(document.activeElement).toBe(src)
  })

  it('lets unhandled and modified shortcut keys bubble to app-level handlers', async () => {
    const onWindowKeydown = vi.fn()
    window.addEventListener('keydown', onWindowKeydown)

    try {
      renderTree({
        entries: [
          makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
          makeEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false }),
        ],
        expandedDirs: new Set<string>(['src']),
      })

      const src = screen.getByRole('treeitem', { name: /src\// }) as HTMLElement
      const main = screen.getByRole('treeitem', { name: /main\.ts/ }) as HTMLElement

      await fireEvent.keyDown(src, { key: 'x' })
      await fireEvent.keyDown(src, { key: 'k', metaKey: true })
      await fireEvent.keyDown(src, { key: 'ArrowDown', metaKey: true })

      expect(onWindowKeydown).toHaveBeenCalledTimes(3)
      expect(document.activeElement).not.toBe(main)

      onWindowKeydown.mockClear()
      await fireEvent.keyDown(src, { key: 'ArrowDown' })

      expect(onWindowKeydown).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(main)
    } finally {
      window.removeEventListener('keydown', onWindowKeydown)
    }
  })

  it('uses left and right arrows to expand, collapse, and move between parent and child items', async () => {
    const onToggleDir = vi.fn()
    const { rerender } = renderTree({
      entries: [makeEntry({ name: 'src', path: 'src', isDir: true, size: null })],
      expandedDirs: new Set<string>(),
      onToggleDir,
    })

    const collapsedSrc = screen.getByRole('treeitem', { name: /src\// }) as HTMLElement
    await fireEvent.keyDown(collapsedSrc, { key: 'ArrowRight' })
    expect(onToggleDir).toHaveBeenCalledWith('src')

    await rerender({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false }),
      ],
      expandedDirs: new Set<string>(['src']),
      selectedPath: null,
      onToggleDir,
      onSelectFile: () => {},
    })

    const expandedSrc = screen.getByRole('treeitem', { name: /src\// }) as HTMLElement
    const child = screen.getByRole('treeitem', { name: /main\.ts/ }) as HTMLElement
    await fireEvent.keyDown(expandedSrc, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(child)

    await fireEvent.keyDown(child, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(expandedSrc)

    await fireEvent.keyDown(expandedSrc, { key: 'ArrowLeft' })
    expect(onToggleDir).toHaveBeenLastCalledWith('src')
  })

  it('activates the focused treeitem with Enter and Space', async () => {
    const onToggleDir = vi.fn()
    const onSelectFile = vi.fn()
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'README.md', path: 'README.md', isDir: false }),
      ],
      onToggleDir,
      onSelectFile,
    })

    await fireEvent.keyDown(screen.getByRole('treeitem', { name: /src\// }), { key: 'Enter' })
    await fireEvent.keyDown(screen.getByRole('treeitem', { name: /README\.md/ }), { key: ' ' })

    expect(onToggleDir).toHaveBeenCalledWith('src')
    expect(onSelectFile).toHaveBeenCalledWith('README.md')
  })

  it('restores initial scroll position and reports scroll changes', async () => {
    const onScrollTopChange = vi.fn()
    renderTree({
      entries: [
        makeEntry({ name: 'one.ts', path: 'one.ts', isDir: false }),
        makeEntry({ name: 'two.ts', path: 'two.ts', isDir: false }),
      ],
      initialScrollTop: 42,
      onScrollTopChange,
    })

    const scrollRegion = screen.getAllByTestId('tree-entry')[0]?.parentElement as HTMLDivElement
    expect(scrollRegion.scrollTop).toBe(42)

    scrollRegion.scrollTop = 84
    await fireEvent.scroll(scrollRegion)

    expect(onScrollTopChange).toHaveBeenCalledWith(84)
  })

  it('does not mark unselected files as current', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'index.ts', path: 'src/index.ts', isDir: false }),
        makeEntry({ name: 'utils.ts', path: 'src/lib/utils.ts', isDir: false }),
      ],
      selectedPath: 'src/lib/utils.ts',
    })

    expect(screen.getByRole('treeitem', { name: /index\.ts/ }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('treeitem', { name: /index\.ts/ }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('treeitem', { name: /utils\.ts/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('treeitem', { name: /utils\.ts/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('renders a file-type icon for files and a folder icon for directories', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true }),
        makeEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false }),
      ],
      expandedDirs: new Set(['src']),
    })

    expect(document.querySelector('[data-icon="folder-open"]')).not.toBeNull()
    expect(document.querySelector('[data-icon="typescript"]')).not.toBeNull()
  })
})
