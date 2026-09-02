import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lucide/svelte', () => ({
  FolderCog: vi.fn(() => ({})),
  FolderOpen: vi.fn(() => ({})),
  Search: vi.fn(() => ({})),
  X: vi.fn(() => ({})),
}))

import FileTreeToolbar from './FileTreeToolbar.svelte'

afterEach(cleanup)

describe('FileTreeToolbar', () => {
  it('forwards search and generated-folder controls through its focused actions', async () => {
    const onSearchInput = vi.fn()
    const onClearSearch = vi.fn()
    const onToggleHiddenRootEntries = vi.fn()

    render(FileTreeToolbar, {
      props: {
        model: {
          sourceLabel: null,
          searchQuery: 'readme',
          hiddenRootEntryCount: 3,
          showHiddenRootEntries: false,
        },
        actions: {
          onSearchInput,
          onClearSearch,
          onToggleHiddenRootEntries,
        },
      },
    })

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search files' }), {
      target: { value: 'source' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Show generated folders (3)' }))

    expect(onSearchInput).toHaveBeenCalledWith('source')
    expect(onClearSearch).toHaveBeenCalledOnce()
    expect(onToggleHiddenRootEntries).toHaveBeenCalledOnce()
  })
})
