import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
import type { FileContent } from '@openforge/plugin-sdk/domain'
import FileContentViewer from './FileContentViewer.svelte'

vi.mock('@lucide/svelte', () => ({
  Archive: vi.fn(() => ({})),
  CircleAlert: vi.fn(() => ({})),
  FileQuestion: vi.fn(() => ({})),
  TriangleAlert: vi.fn(() => ({})),
}))

function makeApi(): FrontendOpenForgeAPI {
  return {} as FrontendOpenForgeAPI
}

const textContent: FileContent = {
  type: 'text',
  content: 'Hello world',
  mimeType: 'text/plain',
  size: 11,
}

function renderViewer(props: Partial<{
  content: FileContent | null
  fileName: string
  filePath: string
  projectId: string | null
  error: string | null
  modifiedAt: number | null
  onRetryFile: () => void
  focusRequestKey: number
  onReturnFocusToTree: () => void
}> = {}) {
  return render(FileContentViewer, {
    props: {
      api: makeApi(),
      content: null,
      fileName: 'README.md',
      filePath: 'README.md',
      projectId: 'test-project-id',
      error: null,
      modifiedAt: null,
      ...props,
    },
  })
}

describe('plugin FileContentViewer recovery and accessibility states', () => {
  it('shows visible loading copy for the selected file', () => {
    renderViewer({ content: null, error: null, fileName: 'README.md' })

    expect(screen.getByText('Loading README.md…')).toBeTruthy()
  })

  it('announces file loading with status semantics', () => {
    renderViewer({ content: null, error: null })

    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.getAttribute('aria-atomic')).toBe('true')
    expect(status.textContent).toContain('Loading README.md')
  })

  it('announces file load completion with status semantics', () => {
    renderViewer({ content: textContent, error: null })

    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toContain('Loaded README.md')
  })

  it('announces file loading errors with status semantics', () => {
    renderViewer({ content: null, error: 'Permission denied' })

    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toContain('Unable to load README.md: Permission denied')
  })

  it('offers a contextual retry action when file loading fails', async () => {
    const retry = vi.fn()

    renderViewer({ content: null, error: 'File not found', fileName: 'missing.txt', onRetryFile: retry })

    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading missing.txt' }))

    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('focuses the preview pane when requested and describes the keyboard path', async () => {
    const { rerender } = renderViewer({ content: textContent, focusRequestKey: 1 })

    await rerender({
      api: makeApi(),
      content: textContent,
      fileName: 'README.md',
      filePath: 'README.md',
      projectId: 'test-project-id',
      error: null,
      modifiedAt: null,
      focusRequestKey: 2,
    })

    const previewPane = screen.getByRole('region', { name: 'README.md preview pane' })
    expect(document.activeElement).toBe(previewPane)
    expect(previewPane.getAttribute('aria-describedby')).toBe('file-preview-keyboard-help')
    expect(screen.getByText(/Press Tab to reach preview controls/)).toBeTruthy()
  })

  it('keeps the return-focus control available while loading', async () => {
    const onReturnFocusToTree = vi.fn()
    renderViewer({ content: null, error: null, onReturnFocusToTree })

    await fireEvent.click(screen.getByRole('button', { name: /Return focus to selected file in tree/ }))

    expect(onReturnFocusToTree).toHaveBeenCalledOnce()
  })

  it('keeps the return-focus control available when loading fails', async () => {
    const onReturnFocusToTree = vi.fn()
    renderViewer({ content: null, error: 'Permission denied', onReturnFocusToTree })

    await fireEvent.click(screen.getByRole('button', { name: /Return focus to selected file in tree/ }))

    expect(onReturnFocusToTree).toHaveBeenCalledOnce()
  })

  it('renders unavailable preview states without emoji glyphs', () => {
    const content: FileContent = {
      type: 'document',
      content: '',
      mimeType: 'application/pdf',
      size: 4096,
    }

    const { container } = renderViewer({ content, error: null, fileName: 'manual.pdf' })

    expect(screen.getByText('Document preview unavailable')).toBeTruthy()
    expect(container.textContent).not.toContain('📄')
    expect(container.textContent).not.toContain('⚠️')
  })
})
