import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tick } from 'svelte'
import { activeProjectId } from '../../lib/stores'
import { FILE_VIEWER_VIEW_KEY } from '../../lib/fileViewerView'
import FileQuickOpen from './FileQuickOpen.svelte'

const { mockFsSearchFiles, mockNavigate, mockRevealFileInFileViewer } = vi.hoisted(() => ({
  mockFsSearchFiles: vi.fn<(projectId: string, query: string, limit: number) => Promise<string[]>>(),
  mockNavigate: vi.fn(),
  mockRevealFileInFileViewer: vi.fn<(path: string) => Promise<boolean>>(),
}))

vi.mock('../../lib/stores', async () => {
  const { writable } = await import('svelte/store')
  return { activeProjectId: writable<string | null>('test-project-id') }
})

vi.mock('../../lib/ipc', () => ({
  fsSearchFiles: mockFsSearchFiles,
}))

vi.mock('../../lib/router.svelte', () => ({
  useAppRouter: () => ({ navigate: mockNavigate }),
}))

vi.mock('../../lib/fileViewerPlugin', () => ({
  revealFileInFileViewer: mockRevealFileInFileViewer,
}))

Element.prototype.scrollIntoView = vi.fn()

// Load the component before tests start: a timed-out dynamic import can otherwise
// resume after cleanup and mount a dialog in the following test.
function renderFileQuickOpen(onClose = vi.fn()) {
  return render(FileQuickOpen, { props: { onClose } })
}

function getDialogInput() {
  return within(screen.getByRole('dialog', { name: 'Search files' }))
    .getByRole('combobox', { name: 'Search files...' })
}

describe('FileQuickOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeProjectId.set('test-project-id')
    mockFsSearchFiles.mockResolvedValue([])
    mockRevealFileInFileViewer.mockResolvedValue(true)
  })

  afterEach(async () => {
    try {
      cleanup()
      await tick()
      expect(screen.queryAllByRole('dialog', { hidden: true })).toHaveLength(0)
    } finally {
      if (vi.isFakeTimers()) vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('renders search input and focuses it on mount', async () => {
    renderFileQuickOpen()

    const input = getDialogInput()

    await waitFor(() => {
      expect(document.activeElement).toBe(input)
    })
  })

  it('calls fsSearchFiles only after the latest query has been idle for 150ms', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mockFsSearchFiles.mockResolvedValue(['src/lib/ipc.ts'])
    renderFileQuickOpen()

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'ip' } })
    await vi.advanceTimersByTimeAsync(100)
    expect(mockFsSearchFiles).not.toHaveBeenCalled()

    await fireEvent.input(input, { target: { value: 'ipc' } })
    await vi.advanceTimersByTimeAsync(149)
    expect(mockFsSearchFiles).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await tick()
    expect(mockFsSearchFiles).toHaveBeenCalledExactlyOnceWith('test-project-id', 'ipc', 50)
    expect(screen.getByRole('option', { name: /ipc\.ts/ })).toBeTruthy()
  })

  it('shows no-match state when search returns empty', async () => {
    mockFsSearchFiles.mockResolvedValue([])
    renderFileQuickOpen()

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'zzz' } })

    await waitFor(() => {
      expect(mockFsSearchFiles).toHaveBeenCalled()
      expect(screen.getByRole('status').textContent).toMatch(/No files match your search/i)
      expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
    }, { timeout: 400 })
  })

  it('links the search input to the active file option and clears the active descendant when results empty', async () => {
    mockFsSearchFiles.mockResolvedValue(['src/a.ts', 'src/b.ts'])
    renderFileQuickOpen()

    const input = getDialogInput()
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    await fireEvent.input(input, { target: { value: 'ts' } })

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2), { timeout: 400 })

    const listbox = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')
    expect(listbox.id).not.toBe('')
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    expect(options.every(option => option.id !== '')).toBe(true)
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id)

    mockFsSearchFiles.mockResolvedValueOnce([])
    await fireEvent.input(input, { target: { value: 'nothing' } })

    await waitFor(() => expect(screen.getByText(/no files match your search/i)).toBeTruthy(), { timeout: 400 })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
  })

  it('filters out directory entries from results', async () => {
    mockFsSearchFiles.mockResolvedValue(['src/lib/', 'src/lib/ipc.ts'])
    renderFileQuickOpen()

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'lib' } })

    await waitFor(() => {
      expect(screen.getByText('ipc.ts')).toBeTruthy()
    }, { timeout: 400 })

    expect(screen.queryByText('lib')).toBeNull()
  })

  it('supports keyboard navigation and select via Enter', async () => {
    mockFsSearchFiles.mockResolvedValue(['a.ts', 'b.ts', 'c.ts'])
    const onClose = vi.fn()
    renderFileQuickOpen(onClose)

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'ts' } })

    await waitFor(() => {
      expect(screen.getByText('a.ts')).toBeTruthy()
      expect(screen.getByText('b.ts')).toBeTruthy()
    }, { timeout: 400 })

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    await fireEvent.keyDown(dialog, { key: 'Enter' })

    await waitFor(() => {
      expect(mockRevealFileInFileViewer).toHaveBeenCalledWith('b.ts')
      expect(mockNavigate).toHaveBeenCalledWith(FILE_VIEWER_VIEW_KEY)
      expect(onClose).toHaveBeenCalledOnce()
    })
  })

  it('Escape closes the modal', async () => {
    const onClose = vi.fn()
    renderFileQuickOpen(onClose)

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('backdrop click closes modal', async () => {
    const onClose = vi.fn()
    renderFileQuickOpen(onClose)

    const backdrop = screen.getByTestId('file-quick-open-backdrop')
    await fireEvent.click(backdrop)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows project-required state when no active project', async () => {
    activeProjectId.set(null)
    renderFileQuickOpen()

    expect(screen.getByText(/Select a project first/i)).toBeTruthy()
  })

  it('clears debounce timer on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { unmount } = renderFileQuickOpen()

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'test' } })
    expect(mockFsSearchFiles).not.toHaveBeenCalled()

    unmount()
    await vi.advanceTimersByTimeAsync(150)
    expect(mockFsSearchFiles).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('dialog', { hidden: true })).toHaveLength(0)
  })

  it('can clean up before autofocus settles and focus a fresh dialog', async () => {
    renderFileQuickOpen()
    const previousInput = getDialogInput()
    cleanup()
    await tick()
    expect(screen.queryAllByRole('dialog', { hidden: true })).toHaveLength(0)

    renderFileQuickOpen()
    const input = getDialogInput()
    expect(input).not.toBe(previousInput)
    await waitFor(() => {
      expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1)
      expect(document.activeElement).toBe(input)
    })
  })

  it('supports Ctrl+J/K for keyboard navigation', async () => {
    mockFsSearchFiles.mockResolvedValue(['a.ts', 'b.ts', 'c.ts'])
    const onClose = vi.fn()
    renderFileQuickOpen(onClose)

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'ts' } })

    await waitFor(() => {
      expect(screen.getByText('a.ts')).toBeTruthy()
    }, { timeout: 400 })

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'j', ctrlKey: true })
    await fireEvent.keyDown(dialog, { key: 'k', ctrlKey: true })
    await fireEvent.keyDown(dialog, { key: 'j', ctrlKey: true })
    await fireEvent.keyDown(dialog, { key: 'Enter' })

    await waitFor(() => {
      expect(mockRevealFileInFileViewer).toHaveBeenCalledWith('b.ts')
    })
  })

  it('displays file name and directory path for results', async () => {
    mockFsSearchFiles.mockResolvedValue(['src/components/App.svelte'])
    renderFileQuickOpen()

    const input = getDialogInput()
    await fireEvent.input(input, { target: { value: 'App' } })

    await waitFor(() => {
      expect(screen.getByText('App.svelte')).toBeTruthy()
      expect(screen.getByText('src/components')).toBeTruthy()
    }, { timeout: 400 })
  })
})
