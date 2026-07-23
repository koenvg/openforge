import { describe, expect, it } from 'vitest'
import { buildSearchResultEntries, collectDirPaths } from './fileSearch'

describe('buildSearchResultEntries', () => {
  it('returns an empty list for no results', () => {
    expect(buildSearchResultEntries([])).toEqual([])
  })

  it('synthesizes ancestor directory entries for a matched file', () => {
    const entries = buildSearchResultEntries(['src/lib/stores.ts'])

    expect(entries).toEqual([
      { name: 'src', path: 'src', isDir: true, size: null, modifiedAt: null },
      { name: 'lib', path: 'src/lib', isDir: true, size: null, modifiedAt: null },
      { name: 'stores.ts', path: 'src/lib/stores.ts', isDir: false, size: null, modifiedAt: null },
    ])
  })

  it('keeps a root-level file without inventing ancestors', () => {
    const entries = buildSearchResultEntries(['README.md'])

    expect(entries).toEqual([
      { name: 'README.md', path: 'README.md', isDir: false, size: null, modifiedAt: null },
    ])
  })

  it('deduplicates shared ancestor directories across matches', () => {
    const entries = buildSearchResultEntries(['src/lib/stores.ts', 'src/lib/ipc.ts'])
    const paths = entries.map((entry) => entry.path)

    expect(paths).toEqual(['src', 'src/lib', 'src/lib/ipc.ts', 'src/lib/stores.ts'])
  })

  it('ignores directory-suffixed paths returned by the search backend', () => {
    const entries = buildSearchResultEntries(['src/lib/', 'src/lib/stores.ts'])
    const dirEntry = entries.find((entry) => entry.path === 'src/lib')

    // The directory node comes from ancestor synthesis, not from the raw "src/lib/" result.
    expect(dirEntry).toEqual({ name: 'lib', path: 'src/lib', isDir: true, size: null, modifiedAt: null })
    expect(entries.filter((entry) => entry.path === 'src/lib')).toHaveLength(1)
  })

  it('orders siblings with directories before files, each alphabetically', () => {
    const entries = buildSearchResultEntries([
      'src/utils/format.ts',
      'src/app.ts',
      'src/components/Button.svelte',
    ])
    const paths = entries.map((entry) => entry.path)

    expect(paths).toEqual([
      'src',
      'src/components',
      'src/components/Button.svelte',
      'src/utils',
      'src/utils/format.ts',
      'src/app.ts',
    ])
  })
})

describe('collectDirPaths', () => {
  it('returns every directory path from the entries', () => {
    const entries = buildSearchResultEntries(['src/lib/stores.ts', 'README.md'])

    expect(collectDirPaths(entries)).toEqual(new Set(['src', 'src/lib']))
  })

  it('returns an empty set when there are no directories', () => {
    const entries = buildSearchResultEntries(['README.md'])

    expect(collectDirPaths(entries)).toEqual(new Set())
  })
})
