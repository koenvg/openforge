import { describe, expect, it } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { FileTreeNavigationState } from './fileTreeNavigation.svelte'

function makeFile(filename: string): PrFileDiff {
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
  }
}

describe('FileTreeNavigationState', () => {
  it('starts with every directory expanded', () => {
    const state = new FileTreeNavigationState([
      makeFile('src/lib/a.ts'),
      makeFile('tests/b.ts'),
    ])

    expect([...state.expandedDirectories]).toEqual(['src', 'src/lib', 'tests'])
  })

  it('selects by visible depth-first position and stops at list boundaries', () => {
    const state = new FileTreeNavigationState([])
    const visible = ['src/a.ts', 'src/b.ts']

    expect(state.selectByOffset(visible, 1)).toBe('src/a.ts')
    expect(state.selectByOffset(visible, 1)).toBe('src/b.ts')
    expect(state.selectByOffset(visible, 1)).toBeNull()
    expect(state.selectedFilename).toBe('src/b.ts')
    expect(state.selectByOffset(visible, -1)).toBe('src/a.ts')
  })

  it('uses the last visible file when navigating upward without a selection', () => {
    const state = new FileTreeNavigationState([])

    expect(state.selectByOffset(['a.ts', 'b.ts'], -1)).toBe('b.ts')
  })

  it('falls back to the first visible file when the selection is hidden', () => {
    const state = new FileTreeNavigationState([])
    state.select('hidden.ts')

    expect(state.activeFilename(['visible.ts'])).toBe('visible.ts')
  })

  it("expands and collapses the selected file's immediate parent", () => {
    const state = new FileTreeNavigationState([makeFile('src/lib/a.ts')])
    state.select('src/lib/a.ts')

    state.setSelectedParentExpanded(false)
    expect(state.expandedDirectories.has('src/lib')).toBe(false)
    expect(state.expandedDirectories.has('src')).toBe(true)

    state.setSelectedParentExpanded(true)
    expect(state.expandedDirectories.has('src/lib')).toBe(true)
  })
})
