import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@openforge-app/plugin-sdk/domain'
import type { FileBrowserWorkspaceIdentity } from './workspaceSource'
import {
  countDefaultHiddenRootEntries,
  createEmptyFileBrowserWorkspaceState,
  filterFileBrowserRootEntries,
  flattenFileBrowserEntries,
  getFileBrowserWorkspaceState,
  isDefaultHiddenRootEntry,
  updateFileBrowserWorkspaceState,
} from './fileExplorer'

describe('file viewer browser state helpers', () => {
  const rootEntries: FileEntry[] = [
    { name: 'src', path: 'src', isDir: true, size: null, modifiedAt: null },
    { name: 'README.md', path: 'README.md', isDir: false, size: 128, modifiedAt: null },
  ]
  const noisyRootEntries: FileEntry[] = [
    { name: '.openforge-dev', path: '.openforge-dev', isDir: true, size: null, modifiedAt: null },
    { name: 'node_modules', path: 'node_modules', isDir: true, size: null, modifiedAt: null },
    { name: 'dist-electron', path: 'dist-electron', isDir: true, size: null, modifiedAt: null },
    { name: 'src', path: 'src', isDir: true, size: null, modifiedAt: null },
    { name: 'README.md', path: 'README.md', isDir: false, size: 128, modifiedAt: null },
  ]
  const srcEntries: FileEntry[] = [
    { name: 'main.ts', path: 'src/main.ts', isDir: false, size: 256, modifiedAt: null },
  ]

  it('creates isolated default state for each workspace identity', () => {
    const states = new Map<FileBrowserWorkspaceIdentity, ReturnType<typeof createEmptyFileBrowserWorkspaceState>>()

    const projectA = getFileBrowserWorkspaceState(states, 'project:project-a')
    projectA.expandedPaths.add('src')

    const projectB = getFileBrowserWorkspaceState(states, 'project:project-b')

    expect(projectB.expandedPaths.has('src')).toBe(false)
    expect(projectB.selectedPath).toBeNull()
    expect(projectB.showHiddenRootEntries).toBe(false)
  })

  it('keeps project and task selection, expansion, search, and scroll state isolated', () => {
    let states = new Map<FileBrowserWorkspaceIdentity, ReturnType<typeof createEmptyFileBrowserWorkspaceState>>()
    states = updateFileBrowserWorkspaceState(states, 'project:project-a', (state) => ({
      ...state,
      rootEntries,
      expandedPaths: new Set(['src']),
      selectedPath: 'src/main.ts',
      selectedSuffix: '#project-heading',
      treeScrollTop: 120,
      contentScrollTop: 340,
      searchQuery: 'main',
      searchResults: ['src/main.ts'],
      completedSearchQuery: 'main',
    }))
    states = updateFileBrowserWorkspaceState(states, 'task:task-a', (state) => ({
      ...state,
      rootEntries: [{ name: 'docs', path: 'docs', isDir: true, size: null, modifiedAt: null }],
      expandedPaths: new Set(['docs']),
      selectedPath: 'docs/task.md',
      selectedSuffix: '?task-preview=1',
      treeScrollTop: 25,
      contentScrollTop: 75,
      searchQuery: 'task',
      searchResults: ['docs/task.md'],
      completedSearchQuery: 'task',
    }))

    const project = getFileBrowserWorkspaceState(states, 'project:project-a')
    const task = getFileBrowserWorkspaceState(states, 'task:task-a')

    expect(project).toMatchObject({
      selectedPath: 'src/main.ts',
      selectedSuffix: '#project-heading',
      treeScrollTop: 120,
      contentScrollTop: 340,
      searchQuery: 'main',
      searchResults: ['src/main.ts'],
    })
    expect(project.expandedPaths).toEqual(new Set(['src']))
    expect(task).toMatchObject({
      selectedPath: 'docs/task.md',
      selectedSuffix: '?task-preview=1',
      treeScrollTop: 25,
      contentScrollTop: 75,
      searchQuery: 'task',
      searchResults: ['docs/task.md'],
    })
    expect(task.expandedPaths).toEqual(new Set(['docs']))
  })

  it('returns a new Map when updating state so Svelte stores react', () => {
    const states = new Map<FileBrowserWorkspaceIdentity, ReturnType<typeof createEmptyFileBrowserWorkspaceState>>()

    const next = updateFileBrowserWorkspaceState(states, 'project:project-a', (state) => ({
      ...state,
      selectedPath: 'README.md',
    }))

    expect(next).not.toBe(states)
    expect(getFileBrowserWorkspaceState(next, 'project:project-a').selectedPath).toBe('README.md')
    expect(states.has('project:project-a')).toBe(false)
  })

  it('flattens cached expanded directories in file tree order', () => {
    const state = createEmptyFileBrowserWorkspaceState()
    state.rootEntries = rootEntries
    state.dirContents = new Map([['src', srcEntries]])
    state.expandedPaths = new Set(['src'])

    expect(flattenFileBrowserEntries(state)).toEqual([
      rootEntries[0],
      srcEntries[0],
      rootEntries[1],
    ])
  })

  it('identifies generated/vendor/runtime root directories hidden by default', () => {
    expect(noisyRootEntries.filter(isDefaultHiddenRootEntry).map((entry) => entry.path)).toEqual([
      '.openforge-dev',
      'node_modules',
      'dist-electron',
    ])
    expect(countDefaultHiddenRootEntries(noisyRootEntries)).toBe(3)
  })

  it('filters noisy root entries by default while preserving explicit access', () => {
    expect(filterFileBrowserRootEntries(noisyRootEntries, false).map((entry) => entry.path)).toEqual([
      'src',
      'README.md',
    ])
    expect(filterFileBrowserRootEntries(noisyRootEntries, true).map((entry) => entry.path)).toEqual([
      '.openforge-dev',
      'node_modules',
      'dist-electron',
      'src',
      'README.md',
    ])
  })

  it('filters noisy root entries when flattening but not matching nested directories', () => {
    const state = createEmptyFileBrowserWorkspaceState()
    state.rootEntries = noisyRootEntries
    state.dirContents = new Map([
      ['src', [
        { name: 'node_modules', path: 'src/node_modules', isDir: true, size: null, modifiedAt: null },
        { name: 'main.ts', path: 'src/main.ts', isDir: false, size: 256, modifiedAt: null },
      ]],
    ])
    state.expandedPaths = new Set(['src'])

    expect(flattenFileBrowserEntries(state).map((entry) => entry.path)).toEqual([
      'src',
      'src/node_modules',
      'src/main.ts',
      'README.md',
    ])

    state.showHiddenRootEntries = true
    expect(flattenFileBrowserEntries(state).map((entry) => entry.path)).toEqual([
      '.openforge-dev',
      'node_modules',
      'dist-electron',
      'src',
      'src/node_modules',
      'src/main.ts',
      'README.md',
    ])
  })
})
