import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { FileContent } from '@openforge-app/plugin-sdk/domain'
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

const sampleModifiedAt = Date.UTC(2024, 2, 9, 15, 30)
const formattedModifiedAt = new Date(sampleModifiedAt).toLocaleString('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('shows file loading errors with the selected file name', () => {
    renderViewer({ content: null, error: 'File not found', fileName: 'missing.txt' })

    expect(screen.getByText('File not found')).toBeTruthy()
    expect(screen.getByText('missing.txt')).toBeTruthy()
  })

  it('renders text content with line numbers and metadata', () => {
    const content: FileContent = {
      type: 'text',
      content: 'line1\nline2',
      mimeType: 'text/plain',
      size: 11,
    }

    renderViewer({ content, error: null, fileName: 'notes.txt', modifiedAt: sampleModifiedAt })

    expect(screen.getByText(/line1/)).toBeTruthy()
    expect(screen.getByText(/line2/)).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'File text content' })).toBeTruthy()
    expect(screen.getByText('11 B')).toBeTruthy()
    expect(screen.getByText('text/plain')).toBeTruthy()
    expect(screen.getByText('2 lines')).toBeTruthy()
    expect(screen.getByText(`Modified ${formattedModifiedAt}`)).toBeTruthy()
  })

  it('renders supported text files in the plain text preview region', () => {
    const content: FileContent = {
      type: 'text',
      content: 'const total = 1',
      mimeType: 'text/plain',
      size: 15,
    }

    renderViewer({ content, error: null, fileName: 'notes.ts', filePath: 'notes.ts' })

    const textRegion = screen.getByRole('region', { name: 'File text content' })
    expect(textRegion.textContent).toContain('const total = 1')
  })

  it('preserves plugin-specific MarkdownFilePreview behavior for markdown files', () => {
    const content: FileContent = {
      type: 'text',
      content: '# Hello World\n\nThis is **bold**.',
      mimeType: 'text/markdown',
      size: 34,
    }

    renderViewer({ content, error: null, fileName: 'README.md', filePath: 'docs/README.md' })

    expect(screen.getByRole('region', { name: 'Markdown file content' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Hello World' })).toBeTruthy()
    expect(screen.getByText('bold')).toBeTruthy()
    expect(screen.queryByText('1')).toBeNull()
  })

  it('shows image previews with file metadata', () => {
    const content: FileContent = {
      type: 'image',
      content: 'base64data',
      mimeType: 'image/png',
      size: 128,
    }

    renderViewer({ content, error: null, fileName: 'logo.png', modifiedAt: sampleModifiedAt })

    const image = screen.getByRole('img', { name: 'logo.png preview' })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,base64data')
    expect(screen.getByText('128 B')).toBeTruthy()
    expect(screen.getByText('image/png')).toBeTruthy()
    expect(screen.getByText(`Modified ${formattedModifiedAt}`)).toBeTruthy()
  })


  it('shows selected-video metadata and native controls without autoplay', () => {
    const content: FileContent = {
      type: 'video',
      content: 'AAECAw==',
      mimeType: 'video/mp4',
      size: 4,
    }
    renderViewer({ content, error: null, fileName: 'demo.mp4', filePath: 'assets/demo.mp4', modifiedAt: sampleModifiedAt })

    const video = screen.getByLabelText('demo.mp4 preview') as HTMLVideoElement
    expect(video.getAttribute('src')).toBe('data:video/mp4;base64,AAECAw==')
    expect(video.controls).toBe(true)
    expect(video.autoplay).toBe(false)
    expect(video.preload).toBe('metadata')
    expect(screen.getByText('4 B')).toBeTruthy()
    expect(screen.getByText('video/mp4')).toBeTruthy()
    expect(screen.getByText(`Modified ${formattedModifiedAt}`)).toBeTruthy()
  })

  it('reports decode errors while keeping selected-video metadata visible', async () => {
    const content: FileContent = { type: 'video', content: 'invalid', mimeType: 'video/webm', size: 7 }
    renderViewer({ content, error: null, fileName: 'broken.webm', filePath: 'broken.webm' })

    await fireEvent.error(screen.getByLabelText('broken.webm preview'))

    expect(screen.getByRole('alert').textContent).toContain('Video playback unavailable')
    expect(screen.getByText('broken.webm')).toBeTruthy()
    expect(screen.getByText('video/webm')).toBeTruthy()
    expect(screen.getByText('7 B')).toBeTruthy()
  })

  it('pauses video playback when the selected file changes', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const content: FileContent = { type: 'video', content: 'video', mimeType: 'video/mp4', size: 5 }
    const { rerender } = renderViewer({ content, error: null, fileName: 'first.mp4', filePath: 'first.mp4' })

    await rerender({
      api: makeApi(),
      content: textContent,
      fileName: 'README.md',
      filePath: 'README.md',
      projectId: 'test-project-id',
      error: null,
      modifiedAt: null,
    })

    await waitFor(() => expect(pause).toHaveBeenCalledTimes(1))
  })

  it('pauses video playback during teardown', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const content: FileContent = { type: 'video', content: 'video', mimeType: 'video/mp4', size: 5 }
    const { unmount } = renderViewer({ content, error: null, fileName: 'demo.mp4', filePath: 'demo.mp4' })

    unmount()

    expect(pause).toHaveBeenCalledTimes(1)
  })
  it('shows metadata-only preview fallbacks for binary, document, and large files', () => {
    const fallbackCases: Array<{ content: FileContent, fileName: string, expected: RegExp | string, metadata: string }> = [
      {
        content: { type: 'binary', content: '', mimeType: 'application/octet-stream', size: 2048 },
        fileName: 'archive.bin',
        expected: /Binary preview unavailable/i,
        metadata: '2.0 KB',
      },
      {
        content: { type: 'document', content: '', mimeType: 'application/pdf', size: 4096 },
        fileName: 'manual.pdf',
        expected: /Document preview unavailable/i,
        metadata: '4.0 KB',
      },
      {
        content: { type: 'large-file', content: '', mimeType: 'text/plain', size: 10 * 1024 * 1024 },
        fileName: 'huge_log.txt',
        expected: /File too large to preview/i,
        metadata: '10.0 MB',
      },
      {
        content: { type: 'large-file', content: '', mimeType: 'video/quicktime', size: 30 * 1024 * 1024 },
        fileName: 'recording.mov',
        expected: /File too large to preview/i,
        metadata: '30.0 MB',
      },
    ]

    for (const previewCase of fallbackCases) {
      const { unmount } = renderViewer({
        content: previewCase.content,
        error: null,
        fileName: previewCase.fileName,
      })

      expect(screen.getByText(previewCase.expected)).toBeTruthy()
      expect(screen.getByText(previewCase.fileName)).toBeTruthy()
      expect(screen.getByText(previewCase.metadata)).toBeTruthy()

      unmount()
    }
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
