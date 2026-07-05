import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FileEntry } from '@openforge-app/plugin-sdk/domain'
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
  focusSelectedRequest: number
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
  it('exposes a screen-reader tree hierarchy with groups and positional metadata', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'components', path: 'src/components', isDir: true, size: null }),
        makeEntry({ name: 'Button.svelte', path: 'src/components/Button.svelte', isDir: false }),
        makeEntry({ name: 'README.md', path: 'README.md', isDir: false }),
      ],
      expandedDirs: new Set<string>(['src', 'src/components']),
    })

    expect(screen.getByRole('tree', { name: 'Project files' })).toBeTruthy()

    const srcDir = screen.getByRole('treeitem', { name: /src\// })
    const srcGroup = within(srcDir).getAllByRole('group')[0] as HTMLElement
    const componentsDir = within(srcGroup).getByRole('treeitem', { name: /components\// })
    const button = screen.getByRole('treeitem', { name: /Button\.svelte/ })

    expect(srcDir.getAttribute('aria-level')).toBe('1')
    expect(srcDir.getAttribute('aria-posinset')).toBe('1')
    expect(srcDir.getAttribute('aria-setsize')).toBe('2')
    expect(srcDir.getAttribute('aria-expanded')).toBe('true')
    expect(componentsDir.getAttribute('aria-level')).toBe('2')
    expect(button.getAttribute('aria-level')).toBe('3')
  })

  it('does not expose child groups for collapsed directories', () => {
    renderTree({
      entries: [
        makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
        makeEntry({ name: 'main.ts', path: 'src/main.ts', isDir: false }),
      ],
      expandedDirs: new Set<string>(),
    })

    const srcDir = screen.getByRole('treeitem', { name: /src\// })
    expect(within(srcDir).queryByRole('group')).toBeNull()
    expect(screen.queryByRole('treeitem', { name: /main\.ts/ })).toBeNull()
  })

  it('uses roving tabindex with arrow, Home, and End navigation', async () => {
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

  it('uses right and left arrows to expand, collapse, and move between parent and child treeitems', async () => {
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

  it('activates directories and files from keyboard and pointer interactions', async () => {
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
    await fireEvent.click(screen.getByRole('treeitem', { name: /README\.md/ }))

    expect(onToggleDir).toHaveBeenCalledWith('src')
    expect(onSelectFile).toHaveBeenCalledWith('README.md')
  })

  it('marks only the selected file as current and selected', () => {
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

  it('focuses the selected file when focus is requested', async () => {
    const { rerender } = renderTree({
      entries: [
        makeEntry({ name: 'index.ts', path: 'src/index.ts', isDir: false }),
        makeEntry({ name: 'utils.ts', path: 'src/lib/utils.ts', isDir: false }),
      ],
      selectedPath: 'src/lib/utils.ts',
      focusSelectedRequest: 1,
    })

    await rerender({
      entries: [
        makeEntry({ name: 'index.ts', path: 'src/index.ts', isDir: false }),
        makeEntry({ name: 'utils.ts', path: 'src/lib/utils.ts', isDir: false }),
      ],
      expandedDirs: new Set<string>(),
      selectedPath: 'src/lib/utils.ts',
      onToggleDir: () => {},
      onSelectFile: () => {},
      focusSelectedRequest: 2,
    })

    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: /utils\.ts/ }))
  })
})
