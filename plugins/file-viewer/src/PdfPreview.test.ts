import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import PdfPreview from './PdfPreview.svelte'
import type { FileBrowserWorkspaceSource } from './lib/workspaceSource'

const engine = vi.hoisted(() => ({ load: vi.fn(), destroy: vi.fn(), fit: vi.fn() }))
vi.mock('./lib/pdf/renderer', () => ({ createPdfSession: () => engine }))
const ready = { status: 'ready', mimeType: 'application/pdf', encoding: 'base64', data: 'JVBERi0xLjc=', size: 8, revision: 'revision', modifiedAt: null } as const
const source = (readDocument = vi.fn().mockResolvedValue(ready)): FileBrowserWorkspaceSource => ({
  identity: 'project:P-1', readDocument,
  readDirectory: vi.fn(), readFile: vi.fn(), searchFiles: vi.fn(),
})

afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals() })

function visible() {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private notify: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.notify([{ isIntersecting: true }]) }
    disconnect() {}
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
}

it('loads only the visible selection and distinguishes reading, parsing and rendering', async () => {
  visible()
  let resolveRead!: (value: typeof ready) => void
  const workspaceSource = source(vi.fn(() => new Promise(resolve => { resolveRead = resolve })))
  let finish!: (value: { pages: number; notice: string; reduced: boolean }) => void
  engine.load.mockImplementation(async (_bytes, phase) => {
    phase('rendering')
    return new Promise(resolve => { finish = resolve })
  })
  const view = render(PdfPreview, { workspaceSource, filePath: 'a.pdf', modifiedAt: null, active: false })
  expect(workspaceSource.readDocument).not.toHaveBeenCalled()
  await view.rerender({ active: true })
  await screen.findByText('Reading PDF bytes…')
  resolveRead(ready)
  await screen.findByText('Rendering first page…')
  finish({ pages: 4, notice: 'Reading order may differ from the visual page.', reduced: false })
  await screen.findByText('Page 1 of 4. Only the first page is available in this preview.')
  expect(screen.getByText('Reading order may differ from the visual page.')).toBeTruthy()
  await view.rerender({ active: false })
  expect(engine.destroy).toHaveBeenCalledTimes(1)
})

it('retries with a fresh authorized read and releases rendering on destruction', async () => {
  visible()
  engine.load.mockResolvedValue({ pages: 1, notice: 'No selectable text is available on this page.', reduced: false })
  const readDocument = vi.fn().mockRejectedValueOnce(new Error('DOCUMENT_PREVIEW_FORBIDDEN: denied')).mockResolvedValue(ready)
  const view = render(PdfPreview, { workspaceSource: source(readDocument), filePath: 'a.pdf', modifiedAt: null })
  await screen.findByText('This PDF cannot be read from the authorized project folder.')
  await fireEvent.click(screen.getByRole('button', { name: 'Retry PDF preview' }))
  await screen.findByText('No selectable text is available on this page.')
  expect(readDocument).toHaveBeenCalledTimes(2)
  view.unmount()
  expect(engine.destroy).toHaveBeenCalledTimes(1)
})

it('discards a stale byte response after selection changes', async () => {
  visible()
  let oldRead!: (value: typeof ready) => void
  const readDocument = vi.fn().mockImplementationOnce(() => new Promise(resolve => { oldRead = resolve })).mockResolvedValue(ready)
  engine.load.mockResolvedValue({ pages: 1, notice: '', reduced: false })
  const view = render(PdfPreview, { workspaceSource: source(readDocument), filePath: 'old.pdf', modifiedAt: null })
  await waitFor(() => expect(readDocument).toHaveBeenCalledWith('old.pdf'))
  await view.rerender({ filePath: 'new.pdf' })
  await screen.findByText('Page 1 of 1')
  oldRead(ready)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(engine.load).toHaveBeenCalledTimes(1)
})

it.each([
  ['DOCUMENT_PREVIEW_TIMEOUT: stalled', 'Reading the PDF timed out. A stalled read may still occupy capacity.'],
  ['DOCUMENT_PREVIEW_BUSY: busy', 'Two document reads are already active. Try again when they finish.'],
  ['DOCUMENT_PREVIEW_CHANGED: changed', 'The PDF or project changed while reading. Retry to read the current file.'],
  ['DOCUMENT_PREVIEW_UNAVAILABLE_HOST: old host', 'PDF previews are unavailable on this host.'],
  ["Error invoking remote method 'openforge:invoke': Error: Rust sidecar command failed: DOCUMENT_PREVIEW_NOT_FOUND: task workspace is unavailable", 'This PDF or its project is no longer available.'],
])('shows a sanitized, manually retryable read failure: %s', async (error, message) => {
  visible()
  const readDocument = vi.fn().mockRejectedValue(new Error(error))
  render(PdfPreview, { workspaceSource: source(readDocument), filePath: 'a.pdf', modifiedAt: null })
  await screen.findByText(message)
  expect(screen.getByRole('button', { name: 'Retry PDF preview' })).toBeTruthy()
  expect(readDocument).toHaveBeenCalledTimes(1)
  expect(engine.load).not.toHaveBeenCalled()
})

it('replaces the document on workspace and modification identity changes, then releases on plugin unload', async () => {
  visible()
  engine.load.mockResolvedValue({ pages: 1, notice: '', reduced: false })
  const workspaceSource = source()
  const view = render(PdfPreview, { workspaceSource, filePath: 'a.pdf', modifiedAt: 1 })
  await screen.findByText('Page 1 of 1')
  await view.rerender({ workspaceSource: { ...workspaceSource, identity: 'project:P-2' } })
  await waitFor(() => expect(engine.load).toHaveBeenCalledTimes(2))
  await view.rerender({ modifiedAt: 2 })
  await waitFor(() => expect(engine.load).toHaveBeenCalledTimes(3))
  const { deactivatePdfPreviews } = await import('./lib/pdf/lifecycle')
  deactivatePdfPreviews()
  view.unmount()
  expect(engine.destroy).toHaveBeenCalledTimes(3)
})

it('uses task document bytes and discards delayed same-name results during rapid task changes', async () => {
  visible()
  const { createTaskWorkspaceSource } = await import('./lib/workspaceSource')
  let finishFirst!: (value: typeof ready) => void
  const readDocument = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve })).mockResolvedValue(ready)
  const projectRead = vi.fn()
  const api = { fs: { readDocument: projectRead, task: { readDocument } } } as unknown as import('@openforge-app/plugin-sdk/frontend').FrontendOpenForgeAPI
  engine.load.mockResolvedValue({ pages: 2, notice: '', reduced: false })
  const view = render(PdfPreview, { workspaceSource: createTaskWorkspaceSource(api, 'T-1'), filePath: 'guide.pdf', modifiedAt: 1, active: false })
  expect(readDocument).not.toHaveBeenCalled()
  await view.rerender({ active: true })
  await waitFor(() => expect(readDocument).toHaveBeenCalledWith({ taskId: 'T-1', path: 'guide.pdf' }))
  await view.rerender({ workspaceSource: createTaskWorkspaceSource(api, 'T-2') })
  await screen.findByText('Page 1 of 2. Only the first page is available in this preview.')
  finishFirst(ready)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(engine.load).toHaveBeenCalledTimes(1)
  expect(readDocument).toHaveBeenLastCalledWith({ taskId: 'T-2', path: 'guide.pdf' })
  await view.rerender({ active: false })
  expect(engine.destroy).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(engine.destroy).toHaveBeenCalledTimes(1)
  expect(projectRead).not.toHaveBeenCalled()
})

it('invalidates a pending PDF when the same task workspace is replaced', async () => {
  visible()
  let finishOld!: (value: typeof ready) => void
  const readDocument = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve })).mockResolvedValue(ready)
  const workspaceSource = { ...source(readDocument), identity: 'task:T-1' as const, documentRevision: 0 }
  engine.load.mockResolvedValue({ pages: 1, notice: '', reduced: false })
  const view = render(PdfPreview, { workspaceSource, filePath: 'guide.pdf', modifiedAt: 1 })
  await waitFor(() => expect(readDocument).toHaveBeenCalledTimes(1))
  await view.rerender({ workspaceSource: { ...workspaceSource, documentRevision: 1 } })
  await screen.findByText('Page 1 of 1')
  finishOld(ready)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(engine.load).toHaveBeenCalledTimes(1)
  expect(readDocument).toHaveBeenCalledTimes(2)
})
