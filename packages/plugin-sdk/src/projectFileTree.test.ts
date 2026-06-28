import { describe, expect, it } from 'vitest'
import {
  buildProjectFileTree,
  flattenVisibleProjectFileTree,
  formatProjectFileTreeSize,
  getProjectFileTreeItemAccessibility,
  getProjectFileTreeKeyboardAction,
  projectFileTreePathToId,
  type ProjectFileTreeEntry,
} from './projectFileTree'

function makeEntry(overrides: Partial<ProjectFileTreeEntry>): ProjectFileTreeEntry {
  return {
    name: 'entry',
    path: 'entry',
    isDir: false,
    size: 128,
    ...overrides,
  }
}

describe('projectFileTree shared behavior', () => {
  it('builds ordered tree metadata from flat file entries', () => {
    const tree = buildProjectFileTree([
      makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
      makeEntry({ name: 'lib', path: 'src/lib', isDir: true, size: null }),
      makeEntry({ name: 'utils.ts', path: 'src/lib/utils.ts' }),
      makeEntry({ name: 'README.md', path: 'README.md' }),
    ])

    expect(tree.map((node) => node.entry.path)).toEqual(['src', 'README.md'])
    expect(tree[0]).toMatchObject({ level: 1, posInSet: 1, setSize: 2, parentPath: null })
    expect(tree[0]?.children[0]).toMatchObject({ level: 2, posInSet: 1, setSize: 1, parentPath: 'src' })
    expect(tree[0]?.children[0]?.children[0]).toMatchObject({
      level: 3,
      posInSet: 1,
      setSize: 1,
      parentPath: 'src/lib',
    })
  })

  it('flattens only visible descendants for expanded directories', () => {
    const tree = buildProjectFileTree([
      makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
      makeEntry({ name: 'lib', path: 'src/lib', isDir: true, size: null }),
      makeEntry({ name: 'utils.ts', path: 'src/lib/utils.ts' }),
      makeEntry({ name: 'README.md', path: 'README.md' }),
    ])

    expect(flattenVisibleProjectFileTree(tree, new Set()).map((node) => node.entry.path)).toEqual(['src', 'README.md'])
    expect(flattenVisibleProjectFileTree(tree, new Set(['src', 'src/lib'])).map((node) => node.entry.path)).toEqual([
      'src',
      'src/lib',
      'src/lib/utils.ts',
      'README.md',
    ])
  })

  it('returns shared ARIA values for files and directories', () => {
    const [src, readme] = buildProjectFileTree([
      makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
      makeEntry({ name: 'README.md', path: 'README.md' }),
    ])
    if (!src || !readme) throw new Error('expected tree fixtures')

    expect(
      getProjectFileTreeItemAccessibility(src, {
        expandedDirs: new Set(['src']),
        selectedPath: 'README.md',
        labelId: 'src-label',
        sizeId: 'src-size',
      })
    ).toEqual({
      level: 1,
      setSize: 2,
      posInSet: 1,
      expanded: true,
      current: undefined,
      selected: undefined,
      labelledBy: 'src-label',
    })

    expect(
      getProjectFileTreeItemAccessibility(readme, {
        expandedDirs: new Set(['src']),
        selectedPath: 'README.md',
        labelId: 'readme-label',
        sizeId: 'readme-size',
      })
    ).toEqual({
      level: 1,
      setSize: 2,
      posInSet: 2,
      expanded: undefined,
      current: 'true',
      selected: 'true',
      labelledBy: 'readme-label readme-size',
    })
  })

  it('returns shared keyboard actions for roving focus, expansion, and activation', () => {
    const tree = buildProjectFileTree([
      makeEntry({ name: 'src', path: 'src', isDir: true, size: null }),
      makeEntry({ name: 'main.ts', path: 'src/main.ts' }),
      makeEntry({ name: 'README.md', path: 'README.md' }),
    ])
    const [src] = tree
    const [main] = src?.children ?? []
    if (!src || !main) throw new Error('expected tree fixtures')

    expect(
      getProjectFileTreeKeyboardAction({ key: 'ArrowRight', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, src, {
        expandedDirs: new Set(),
        visiblePaths: ['src', 'README.md'],
      })
    ).toEqual({ handled: true, type: 'toggle', path: 'src' })

    expect(
      getProjectFileTreeKeyboardAction({ key: 'ArrowRight', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, src, {
        expandedDirs: new Set(['src']),
        visiblePaths: ['src', 'src/main.ts', 'README.md'],
      })
    ).toEqual({ handled: true, type: 'focus', path: 'src/main.ts' })

    expect(
      getProjectFileTreeKeyboardAction({ key: 'ArrowLeft', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, main, {
        expandedDirs: new Set(['src']),
        visiblePaths: ['src', 'src/main.ts', 'README.md'],
      })
    ).toEqual({ handled: true, type: 'focus', path: 'src' })

    expect(
      getProjectFileTreeKeyboardAction({ key: 'End', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, src, {
        expandedDirs: new Set(['src']),
        visiblePaths: ['src', 'src/main.ts', 'README.md'],
      })
    ).toEqual({ handled: true, type: 'focus', path: 'README.md' })

    expect(
      getProjectFileTreeKeyboardAction({ key: ' ', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, main, {
        expandedDirs: new Set(['src']),
        visiblePaths: ['src', 'src/main.ts', 'README.md'],
      })
    ).toEqual({ handled: true, type: 'activate', path: 'src/main.ts' })
  })

  it('leaves shortcut-modified keys unhandled and shares stable label helpers', () => {
    const [node] = buildProjectFileTree([makeEntry({ name: 'README.md', path: 'README.md' })])
    if (!node) throw new Error('expected node')

    expect(
      getProjectFileTreeKeyboardAction({ key: 'ArrowDown', altKey: false, ctrlKey: false, metaKey: true, shiftKey: false }, node, {
        expandedDirs: new Set(),
        visiblePaths: ['README.md'],
      })
    ).toEqual({ handled: false })
    expect(projectFileTreePathToId('src/main.ts')).toBe('project-file-tree-37-36-2r-1b-31-2p-2x-32-1a-38-37')
    expect(formatProjectFileTreeSize(null)).toBe('')
    expect(formatProjectFileTreeSize(1536)).toBe('1.5 KB')
  })
})
