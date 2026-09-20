import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { createMockFrontendOpenForgeApi } from '@openforge-app/plugin-sdk/testing'
import TaskFilesView from './TaskFilesView.svelte'
import { fileBrowserStates } from './lib/stores'

const renderer = vi.hoisted(() => ({ load: vi.fn(), destroy: vi.fn(), fit: vi.fn() }))
vi.mock('./lib/pdf/renderer', () => ({ createPdfSession: () => renderer }))
afterEach(() => { cleanup(); fileBrowserStates.set(new Map()); vi.resetAllMocks(); vi.unstubAllGlobals() })

it('refreshes the selected task PDF on workspace invalidation, ignores other tasks, and unsubscribes on destruction', async () => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private notify: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.notify([{ isIntersecting: true }]) }
    disconnect() {}
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const api = createMockFrontendOpenForgeApi({ taskWorkspaces: { 'T-1': {
    directories: { '': [{ name: 'guide.pdf', path: 'guide.pdf', isDir: false, size: 8, modifiedAt: 1 }] },
    files: { 'guide.pdf': { type: 'document', content: '', mimeType: 'application/pdf', size: 8 } },
    documents: { 'guide.pdf': { status: 'ready', mimeType: 'application/pdf', encoding: 'base64', data: 'JVBERi0xLjc=', size: 8, revision: 'one', modifiedAt: 1 } },
  } } })
  const read = vi.spyOn(api.fs.task, 'readDocument')
  const projectRead = vi.spyOn(api.fs, 'readDocument')
  renderer.load.mockResolvedValue({ pages: 1, notice: '', reduced: false })
  const view = render(TaskFilesView, { props: { api, context: { pluginId: 'pdf', projectId: 'P-1', taskId: 'T-1' }, taskId: 'T-1' } })
  const entry = await screen.findByRole('treeitem', { name: /guide.pdf/ })
  expect(read).not.toHaveBeenCalled()
  await fireEvent.click(entry)
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  await screen.findByText('Page 1 of 1')
  expect(read).toHaveBeenCalledWith({ taskId: 'T-1', path: 'guide.pdf' })
  api.__testing.registry.emitTaskChange({ projectId: 'P-1', taskId: 'T-2', reason: 'execution' })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(read).toHaveBeenCalledTimes(1)
  api.__testing.registry.emitTaskChange({ projectId: 'P-1', taskId: 'T-1', reason: 'execution' })
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  await screen.findByText('Page 1 of 1')
  expect(renderer.destroy).toHaveBeenCalledTimes(1)
  await fireEvent.click(screen.getByRole('button', { name: /Return focus/ }))
  await waitFor(() => expect(document.activeElement).toBe(entry))
  view.unmount()
  api.__testing.registry.emitTaskChange({ projectId: 'P-1', taskId: 'T-1', reason: 'execution' })
  expect(read).toHaveBeenCalledTimes(2)
  expect(renderer.destroy).toHaveBeenCalledTimes(2)
  expect(projectRead).not.toHaveBeenCalled()
})
