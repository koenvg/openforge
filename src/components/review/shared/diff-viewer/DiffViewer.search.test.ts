import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireElement } from '../../../../test-utils/dom'
import { mockDiffHighlighter, mockDiffView } from './DiffViewer.test-harness'
import DiffViewer from './DiffViewer.svelte'
import { modifiedFileWithPatch } from './DiffViewer.test-fixtures'

describe('DiffViewer Search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Line wrapping defaults to on and persists to localStorage; clear it so tests
    // don't depend on a persisted toggle from a previous test.
    localStorage.clear()
  })

  it('passes the configured registerHighlighter through to DiffView', async () => {
    const diffFile = { clearId: vi.fn() }
    const { createDiffWorker } = await import('@openforge-app/pr-review-ui/useDiffWorker.svelte')
    vi.mocked(createDiffWorker).mockReturnValue({
      getDiffFile: () => diffFile as never,
      processing: false,
    })

    render(DiffViewer, { props: { files: [modifiedFileWithPatch] } })

    await waitFor(() => {
      expect(mockDiffView).toHaveBeenCalled()
    })

    const lastCall = mockDiffView.mock.calls.at(-1)
    expect(lastCall?.[1]?.registerHighlighter).toBe(mockDiffHighlighter)
  })

  // --------------------------------------------------------------------------
  // toolbar visibility
  // --------------------------------------------------------------------------

  describe('toolbar visibility', () => {
    it('search input is hidden by default', () => {
      render(DiffViewer, { props: { files: [] } })
      expect(screen.queryByPlaceholderText('Search diff...')).toBeNull()
    })

    it('renders "No files to display" when files is empty', () => {
      render(DiffViewer, { props: { files: [] } })
      expect(screen.getByText('No files to display')).toBeTruthy()
    })

    it('makes search input visible after clicking search icon button', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.queryByPlaceholderText('Search diff...')).not.toBeNull()
    })

    it('shows navigation buttons when search is open', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.getByTitle('Previous match (Shift+Enter)')).toBeTruthy()
      expect(screen.getByTitle('Next match (Enter)')).toBeTruthy()
      expect(screen.getByTitle('Close search (Escape)')).toBeTruthy()
    })

    it('toolbar always renders Split and Unified mode buttons', () => {
      render(DiffViewer, { props: { files: [] } })
      expect(screen.getByText('Split')).toBeTruthy()
      expect(screen.getByText('Unified')).toBeTruthy()
    })
  })

  // --------------------------------------------------------------------------
  // keyboard shortcuts
  // --------------------------------------------------------------------------

  describe('keyboard shortcuts', () => {
    it('Cmd+F opens the search bar', async () => {
      const { container } = render(DiffViewer, { props: { files: [] } })

      const rootDiv = requireElement(container.firstElementChild, HTMLElement)
      await fireEvent.keyDown(rootDiv, { key: 'f', metaKey: true })
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.queryByPlaceholderText('Search diff...')).not.toBeNull()
    })

    it('Ctrl+F opens the search bar', async () => {
      const { container } = render(DiffViewer, { props: { files: [] } })

      const rootDiv = requireElement(container.firstElementChild, HTMLElement)
      await fireEvent.keyDown(rootDiv, { key: 'f', ctrlKey: true })
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.queryByPlaceholderText('Search diff...')).not.toBeNull()
    })

    it('Escape hides the search bar when open', async () => {
      render(DiffViewer, { props: { files: [] } })

      // Open search via button click
      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Verify search is open
      const input = screen.getByPlaceholderText('Search diff...')
      expect(input).toBeTruthy()

      // Press Escape on the input
      await fireEvent.keyDown(input, { key: 'Escape' })
      await new Promise(resolve => setTimeout(resolve, 10))

      // Input should be gone
      expect(screen.queryByPlaceholderText('Search diff...')).toBeNull()
    })

    it('Enter key on search input does not crash when no matches', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      const input = screen.getByPlaceholderText('Search diff...')
      await fireEvent.keyDown(input, { key: 'Enter' })

      // Search bar still open — no crash
      expect(screen.getByPlaceholderText('Search diff...')).toBeTruthy()
    })

    it('Shift+Enter key on search input does not crash when no matches', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      const input = screen.getByPlaceholderText('Search diff...')
      await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

      // Search bar still open — no crash
      expect(screen.getByPlaceholderText('Search diff...')).toBeTruthy()
    })
  })

  // --------------------------------------------------------------------------
  // search input behavior
  // --------------------------------------------------------------------------

  describe('search input behavior', () => {
    it('updates value as user types', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      const input = requireElement(screen.getByPlaceholderText('Search diff...'), HTMLInputElement)
      await fireEvent.input(input, { target: { value: 'hello' } })

      expect(input.value).toBe('hello')
    })

    it('shows "0 results" when query has no matches', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      const input = requireElement(screen.getByPlaceholderText('Search diff...'), HTMLInputElement)
      await fireEvent.input(input, { target: { value: 'xyz' } })

      // Wait for debounce (200ms) + rendering microtasks
      await new Promise(resolve => setTimeout(resolve, 350))

      expect(screen.getByText('0 results')).toBeTruthy()
    })

    it('close button (✕) hides search bar', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.queryByPlaceholderText('Search diff...')).not.toBeNull()

      const closeBtn = screen.getByTitle('Close search (Escape)')
      await fireEvent.click(closeBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(screen.queryByPlaceholderText('Search diff...')).toBeNull()
    })

    it('navigation buttons are disabled when there are no matches', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      const prevBtn = requireElement(screen.getByTitle('Previous match (Shift+Enter)'), HTMLButtonElement)
      const nextBtn = requireElement(screen.getByTitle('Next match (Enter)'), HTMLButtonElement)

      expect(prevBtn.disabled).toBe(true)
      expect(nextBtn.disabled).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // search icon button
  // --------------------------------------------------------------------------

  describe('search icon button', () => {
    it('search icon button is always visible in toolbar', () => {
      render(DiffViewer, { props: { files: [] } })
      const searchBtn = screen.getByTitle('Search (⌘F)')
      expect(searchBtn).toBeTruthy()
    })

    it('search icon button has correct title attribute', () => {
      render(DiffViewer, { props: { files: [] } })
      const searchBtn = requireElement(screen.getByTitle('Search (⌘F)'), HTMLButtonElement)
      expect(searchBtn.title).toBe('Search (⌘F)')
    })

    it('search icon button remains visible when search bar is also open', async () => {
      render(DiffViewer, { props: { files: [] } })

      const searchBtn = screen.getByTitle('Search (⌘F)')
      await fireEvent.click(searchBtn)
      await new Promise(resolve => setTimeout(resolve, 10))

      // Button still in the DOM — search bar opened alongside it
      expect(screen.getByTitle('Search (⌘F)')).toBeTruthy()
      expect(screen.getByPlaceholderText('Search diff...')).toBeTruthy()
    })

    it('Wrap toggle button is always visible alongside the search icon', () => {
      render(DiffViewer, { props: { files: [] } })
      expect(screen.getByTitle(/line wrapping/i)).toBeTruthy()
      expect(screen.getByTitle('Search (⌘F)')).toBeTruthy()
    })
  })
})
