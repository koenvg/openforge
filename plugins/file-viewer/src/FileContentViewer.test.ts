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

function renderViewer(props: Partial<{
  content: FileContent | null
  fileName: string
  filePath: string
  projectId: string | null
  error: string | null
  modifiedAt: number | null
  onRetryFile: () => void
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

describe('plugin FileContentViewer recovery states', () => {
  it('shows visible loading copy for the selected file', () => {
    renderViewer({ content: null, error: null, fileName: 'README.md' })

    expect(screen.getByText('Loading README.md…')).toBeTruthy()
  })

  it('offers a contextual retry action when file loading fails', async () => {
    const retry = vi.fn()

    renderViewer({ content: null, error: 'File not found', fileName: 'missing.txt', onRetryFile: retry })

    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading missing.txt' }))

    expect(retry).toHaveBeenCalledTimes(1)
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
