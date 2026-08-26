import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { TaskFollowUpError, type JsonValue } from '@openforge-app/plugin-sdk'
import { tick } from 'svelte'
import type {
  Disposable,
  PluginStorageScope,
  TaskBrowserSurfaceController,
  TaskBrowserSurfaceState,
} from '@openforge-app/plugin-sdk/frontend'
import { createMockFrontendOpenForgeApi } from '@openforge-app/plugin-sdk/testing'
import { describe, expect, it, vi } from 'vitest'
import TaskBrowserTab from './TaskBrowserTab.svelte'

function browserState(url: string): TaskBrowserSurfaceState {
  return {
    url,
    title: url,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    devToolsOpen: false,
    error: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

function createSurface(
  url: string,
  options: {
    attachment?: Disposable
    navigate?: (url: string) => Promise<TaskBrowserSurfaceState>
  } = {},
): TaskBrowserSurfaceController {
  const state = browserState(url)
  return {
    attach: vi.fn(async () => options.attachment ?? { dispose: vi.fn() }),
    detach: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    getState: vi.fn(async () => state),
    onStateChanged: vi.fn(() => ({ dispose: vi.fn() })),
    navigate: vi.fn(options.navigate ?? (async nextUrl => browserState(nextUrl))),
    goBack: vi.fn(async () => state),
    goForward: vi.fn(async () => state),
    reload: vi.fn(async () => state),
    stop: vi.fn(async () => state),
    openDevTools: vi.fn(async () => ({ ...state, devToolsOpen: true })),
    closeDevTools: vi.fn(async () => ({ ...state, devToolsOpen: false })),
    selectVisibleRegion: vi.fn()
      .mockResolvedValueOnce({
        region: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        comment: 'Button alignment is off',
      })
      .mockResolvedValue(null),
    cancelVisibleRegionSelection: vi.fn(async () => undefined),
    clearVisualFeedback: vi.fn(async () => undefined),
    replaceVisualFeedback: vi.fn(async () => undefined),
    captureExists: vi.fn(async () => true),
    captureVisibleViewport: vi.fn(async () => ({
      artifactId: 'capture-1',
      absolutePath: '/tmp/openforge/capture-1.png',
      mediaType: 'image/png' as const,
      width: 640,
      height: 480,
      url: state.url,
      title: state.title,
      capturedAt: '2026-08-11T14:30:00.000Z',
      dataUrl: 'data:image/png;base64,cG5n',
    })),
    discardCapture: vi.fn(async () => undefined),
  }
}

function props(api: ReturnType<typeof createMockFrontendOpenForgeApi>, taskId: string) {
  return {
    api,
    context: api.context.getSnapshot(),
    taskId,
    projectId: 'P-1',
  }
}

function task(taskId: string) {
  return {
    id: taskId,
    initial_prompt: 'Improve checkout',
    status: 'doing' as const,
    prompt: null,
    title: 'Checkout polish',
    title_source: 'manual' as const,
    title_generated_at: null,
    agent: 'worker',
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    source_ticket_url: null,
    depends_on: [],
    project_id: 'P-1',
    created_at: 0,
    updated_at: 0,
  }
}

describe('TaskBrowserTab lifecycle', () => {
  it('uses a single compact navigation toolbar without a persistent status strip', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(createSurface('https://example.com/'))

    render(TaskBrowserTab, { props: props(api, 'T-A') })

    await screen.findByDisplayValue('https://example.com/')
    expect(screen.getByTestId('browser-navigation-toolbar')).toBeTruthy()
    expect(screen.queryByTestId('browser-status-strip')).toBeNull()
  })

  it('toggles Task Browser DevTools from the navigation toolbar', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://example.com/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    render(TaskBrowserTab, { props: props(api, 'T-A') })

    await screen.findByDisplayValue('https://example.com/')
    const openButton = await screen.findByRole('button', { name: 'Open Developer Tools' })
    expect(openButton.getAttribute('aria-pressed')).toBe('false')
    await fireEvent.click(openButton)
    await waitFor(() => expect(surface.openDevTools).toHaveBeenCalledOnce())

    const closeButton = screen.getByRole('button', { name: 'Close Developer Tools' })
    expect(closeButton.getAttribute('aria-pressed')).toBe('true')
    await fireEvent.click(closeButton)
    await waitFor(() => expect(surface.closeDevTools).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Open Developer Tools' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('cancels active visual-feedback selection before opening Task Browser DevTools', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://example.com/')
    const selection = deferred<null>()
    vi.mocked(surface.selectVisibleRegion).mockReturnValue(selection.promise)
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    render(TaskBrowserTab, { props: props(api, 'T-A') })

    await screen.findByDisplayValue('https://example.com/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await waitFor(() => expect(surface.selectVisibleRegion).toHaveBeenCalledOnce())
    await fireEvent.click(screen.getByRole('button', { name: 'Open Developer Tools' }))
    await waitFor(() => expect(surface.openDevTools).toHaveBeenCalledOnce())

    expect(vi.mocked(surface.cancelVisibleRegionSelection).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(surface.openDevTools).mock.invocationCallOrder[0])
    selection.resolve(null)
  })

  it('keeps the page usable when Task Browser DevTools fail to open', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://example.com/')
    vi.mocked(surface.openDevTools).mockRejectedValueOnce(new Error('Chromium DevTools are unavailable'))
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    render(TaskBrowserTab, { props: props(api, 'T-A') })

    await screen.findByDisplayValue('https://example.com/')
    await fireEvent.click(screen.getByRole('button', { name: 'Open Developer Tools' }))

    expect(await screen.findByText('Chromium DevTools are unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Developer Tools' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('toggles Task Browser DevTools from standard shortcuts while the toolbar has focus', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://example.com/')
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    render(TaskBrowserTab, { props: props(api, 'T-A') })

    const address = await screen.findByDisplayValue('https://example.com/')
    address.focus()
    await fireEvent.keyDown(address, { key: 'F12' })
    await waitFor(() => expect(surface.openDevTools).toHaveBeenCalledOnce())
    await fireEvent.keyDown(address, { key: 'i', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(surface.closeDevTools).toHaveBeenCalledOnce())
    await fireEvent.keyDown(address, { key: 'c', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(surface.openDevTools).toHaveBeenNthCalledWith(2, 'elements'))
    await fireEvent.keyDown(address, { key: 'j', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(surface.openDevTools).toHaveBeenNthCalledWith(3, 'console'))

    await fireEvent.keyDown(address, { key: 'i', metaKey: true, altKey: true })
    expect(surface.closeDevTools).toHaveBeenCalledOnce()
  })

  it('ignores a navigation result from a Task that is no longer active', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const staleNavigation = deferred<TaskBrowserSurfaceState>()
    let staleActionFinished = false
    const firstSurface = createSurface('https://task-a.example/', {
      navigate: async () => {
        const state = await staleNavigation.promise
        staleActionFinished = true
        return state
      },
    })
    const secondSurface = createSurface('https://task-b.example/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockImplementation(async request =>
      request.taskId === 'T-A' ? firstSurface : secondSurface)

    const view = render(TaskBrowserTab, { props: props(api, 'T-A') })
    const address = await screen.findByDisplayValue('https://task-a.example/')
    await fireEvent.input(address, { target: { value: 'https://stale.example/' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => expect(firstSurface.navigate).toHaveBeenCalled())

    await view.rerender(props(api, 'T-B'))
    await screen.findByDisplayValue('https://task-b.example/')
    staleNavigation.resolve(browserState('https://stale.example/'))
    await waitFor(() => expect(staleActionFinished).toBe(true))
    await tick()

    expect((screen.getByRole('textbox', { name: 'Web address' }) as HTMLInputElement).value).toBe('https://task-b.example/')
  })

  it('keeps the newest result when toolbar actions complete out of order', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const firstNavigation = deferred<TaskBrowserSurfaceState>()
    const secondNavigation = deferred<TaskBrowserSurfaceState>()
    let navigationCall = 0
    let firstActionFinished = false
    const surface = createSurface('https://start.example/', {
      navigate: async () => {
        navigationCall += 1
        if (navigationCall === 1) {
          const state = await firstNavigation.promise
          firstActionFinished = true
          return state
        }
        return secondNavigation.promise
      },
    })
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    const address = await screen.findByDisplayValue('https://start.example/')
    await fireEvent.input(address, { target: { value: 'https://first.example/' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await fireEvent.input(address, { target: { value: 'https://second.example/' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => expect(surface.navigate).toHaveBeenCalledTimes(2))

    secondNavigation.resolve(browserState('https://second-result.example/'))
    await screen.findByDisplayValue('https://second-result.example/')
    firstNavigation.resolve(browserState('https://first-result.example/'))
    await waitFor(() => expect(firstActionFinished).toBe(true))
    await tick()

    expect((screen.getByRole('textbox', { name: 'Web address' }) as HTMLInputElement).value).toBe('https://second-result.example/')
  })

  it('continues switching Tasks when detaching the previous surface fails', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const firstSurface = createSurface('https://task-a.example/', {
      attachment: { dispose: vi.fn(async () => { throw new Error('detach failed') }) },
    })
    const secondSurface = createSurface('https://task-b.example/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockImplementation(async request =>
      request.taskId === 'T-A' ? firstSurface : secondSurface)

    const view = render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://task-a.example/')
    await view.rerender(props(api, 'T-B'))

    await screen.findByDisplayValue('https://task-b.example/')
  })

  it('offers retry after surface creation fails', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://recovered.example/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate')
      .mockRejectedValueOnce(new Error('host unavailable'))
      .mockResolvedValue(surface)

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    expect(await screen.findByText('Browser unavailable')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByDisplayValue('https://recovered.example/')
  })

  it('exposes a comment icon only after the Browser Surface is live', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const openingSurface = deferred<TaskBrowserSurfaceController>()
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockReturnValue(openingSurface.promise)

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    expect(screen.queryByRole('button', { name: 'Add visual feedback' })).toBeNull()

    openingSurface.resolve(createSurface('https://live.example/'))
    expect(await screen.findByRole('button', { name: 'Add visual feedback' })).toBeTruthy()
  })

  it('captures selected live-page feedback in the background without replacing the browser', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    const address = await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))

    await waitFor(() => expect(surface.selectVisibleRegion).toHaveBeenCalledTimes(2))
    expect(surface.captureVisibleViewport).toHaveBeenCalledTimes(1)
    expect(surface.selectVisibleRegion).toHaveBeenCalledBefore(surface.captureVisibleViewport as never)
    expect(address).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'Captured browser viewport' })).toBeNull()
    expect(screen.queryByText('Return to browser')).toBeNull()
    expect(screen.queryByText('Review capture')).toBeNull()
    expect(screen.getByText('1 screenshot · 1 annotation')).toBeTruthy()
    expect(surface.detach).not.toHaveBeenCalled()
    expect(surface.destroy).not.toHaveBeenCalled()
  })

  it('allows sending while region selection remains active', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    const selectionCancelled = deferred<null>()
    vi.mocked(surface.selectVisibleRegion)
      .mockReset()
      .mockResolvedValueOnce({
        region: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        comment: 'Button alignment is off',
      })
      .mockImplementationOnce(() => selectionCancelled.promise)
    vi.mocked(surface.cancelVisibleRegionSelection).mockImplementation(async () => {
      selectionCancelled.resolve(null)
    })
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)
    api.tasks.get = vi.fn(async taskId => task(taskId))
    api.tasks.sendFollowUp = vi.fn(async request => ({
      taskId: request.taskId,
      sessionId: 'S-1',
      disposition: 'queued' as const,
    }))

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await screen.findByText('1 screenshot · 1 annotation')

    const send = screen.getByRole('button', { name: 'Send visual feedback to agent' }) as HTMLButtonElement
    expect(send.disabled).toBe(false)
    await fireEvent.click(send)

    await waitFor(() => expect(api.tasks.sendFollowUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('1 screenshot · 1 annotation')).toBeNull())
  })

  it('restores the feedback count and send action after leaving and reopening the Task Browser', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    const firstView = render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await screen.findByText('1 screenshot · 1 annotation')
    firstView.unmount()

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')

    expect(screen.getByText('1 screenshot · 1 annotation')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send visual feedback to agent' })).toBeTruthy()
    expect(surface.discardCapture).not.toHaveBeenCalled()
  })
  it('submits immediately once, then clears acknowledged feedback while retaining artifacts', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    const delivery = deferred<{ taskId: string; sessionId: string; disposition: 'queued' }>()
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)
    api.tasks.get = vi.fn(async taskId => task(taskId))
    api.tasks.sendFollowUp = vi.fn(() => delivery.promise)

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await screen.findByText('1 screenshot · 1 annotation')

    const send = screen.getByRole('button', { name: 'Send visual feedback to agent' })
    await fireEvent.click(send)
    await fireEvent.click(send)

    await waitFor(() => expect(api.tasks.sendFollowUp).toHaveBeenCalledTimes(1))
    expect(api.tasks.sendFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'T-A',
      message: expect.stringContaining('PNG: `/tmp/openforge/capture-1.png`'),
    }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((send as HTMLButtonElement).disabled).toBe(true)
    expect(surface.clearVisualFeedback).not.toHaveBeenCalled()

    delivery.resolve({ taskId: 'T-A', sessionId: 'S-1', disposition: 'queued' })
    await waitFor(() => expect(screen.queryByText('1 screenshot · 1 annotation')).toBeNull())
    expect(surface.clearVisualFeedback).toHaveBeenCalledTimes(1)
    expect(surface.discardCapture).not.toHaveBeenCalled()
  })

  it('retains the unchanged collection after a typed failure and retries successfully', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)
    api.tasks.get = vi.fn(async taskId => task(taskId))
    api.tasks.sendFollowUp = vi.fn()
      .mockRejectedValueOnce(new TaskFollowUpError('NO_SESSION', 'No Agent Session exists for Task T-A'))
      .mockResolvedValueOnce({ taskId: 'T-A', sessionId: 'S-1', disposition: 'delivered' })

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await screen.findByText('1 screenshot · 1 annotation')

    await fireEvent.click(screen.getByRole('button', { name: 'Send visual feedback to agent' }))
    expect(await screen.findByText('No Agent Session exists for Task T-A')).toBeTruthy()
    expect(screen.getByText('1 screenshot · 1 annotation')).toBeTruthy()
    expect(surface.discardCapture).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: 'Send visual feedback to agent' }))
    await waitFor(() => expect(screen.queryByText('1 screenshot · 1 annotation')).toBeNull())
    expect(api.tasks.sendFollowUp).toHaveBeenCalledTimes(2)
  })

  it('retains acknowledged artifacts when the Task changes during delivery', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const firstSurface = createSurface('https://task-a.example/')
    const secondSurface = createSurface('https://task-b.example/')
    const delivery = deferred<{ taskId: string; sessionId: string; disposition: 'delivered' }>()
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockImplementation(async request =>
      request.taskId === 'T-A' ? firstSurface : secondSurface)
    api.tasks.get = vi.fn(async taskId => task(taskId))
    api.tasks.sendFollowUp = vi.fn(() => delivery.promise)

    const view = render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://task-a.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await screen.findByText('1 screenshot · 1 annotation')
    await fireEvent.click(screen.getByRole('button', { name: 'Send visual feedback to agent' }))

    const switching = view.rerender(props(api, 'T-B'))
    delivery.resolve({ taskId: 'T-A', sessionId: 'S-1', disposition: 'delivered' })
    await switching
    await screen.findByDisplayValue('https://task-b.example/')

    expect(firstSurface.discardCapture).not.toHaveBeenCalled()
    expect(api.tasks.sendFollowUp).toHaveBeenCalledTimes(1)
  })

  it('collects multiple annotations while reusing unchanged capture evidence', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    vi.mocked(surface.selectVisibleRegion)
      .mockReset()
      .mockResolvedValueOnce({
        region: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        comment: 'First comment',
      })
      .mockResolvedValueOnce({
        region: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
        comment: 'Second comment',
      })
      .mockResolvedValue(null)
    vi.mocked(surface.captureVisibleViewport)
      .mockResolvedValueOnce({
        artifactId: 'capture-1',
        absolutePath: '/tmp/openforge/capture-1.png',
        mediaType: 'image/png',
        width: 640,
        height: 480,
        url: 'https://capture.example/',
        title: 'Capture page',
        capturedAt: '2026-08-11T14:30:00.000Z',
        dataUrl: 'data:image/png;base64,dW5jaGFuZ2Vk',
      })
      .mockResolvedValueOnce({
        artifactId: 'capture-duplicate',
        absolutePath: '/tmp/openforge/capture-duplicate.png',
        mediaType: 'image/png',
        width: 640,
        height: 480,
        url: 'https://capture.example/',
        title: 'Capture page',
        capturedAt: '2026-08-11T14:31:00.000Z',
        dataUrl: 'data:image/png;base64,dW5jaGFuZ2Vk',
      })
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))

    expect(await screen.findByText('1 screenshot · 2 annotations')).toBeTruthy()
    expect(surface.captureVisibleViewport).toHaveBeenCalledTimes(2)
    expect(surface.discardCapture).toHaveBeenCalledWith('capture-duplicate')

    await fireEvent.click(screen.getByRole('button', { name: 'Review visual feedback' }))
    const review = screen.getByRole('region', { name: 'Visual feedback review' })
    expect(review.textContent).toContain('Capture 1')
    expect(review.textContent).toContain('Annotation 1')
    expect((screen.getByRole('textbox', { name: 'Comment for annotation 1' }) as HTMLTextAreaElement).value).toBe('First comment')
    expect(review.textContent).toContain('Annotation 2')
    expect((screen.getByRole('textbox', { name: 'Comment for annotation 2' }) as HTMLTextAreaElement).value).toBe('Second comment')
    expect(screen.queryByRole('img', { name: 'Captured browser viewport' })).toBeNull()
  })

  it('orders multiple live-page captures and sends the complete session once', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://first.example/')
    vi.mocked(surface.selectVisibleRegion)
      .mockReset()
      .mockResolvedValueOnce({
        region: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        comment: 'First state',
      })
      .mockResolvedValueOnce(null)
    vi.mocked(surface.captureVisibleViewport)
      .mockResolvedValueOnce({
        artifactId: 'capture-1',
        absolutePath: '/tmp/openforge/capture-1.png',
        mediaType: 'image/png',
        width: 640,
        height: 480,
        url: 'https://first.example/',
        title: 'First page',
        capturedAt: '2026-08-11T14:30:00.000Z',
        dataUrl: 'data:image/png;base64,Zmlyc3Q=',
      })
      .mockResolvedValueOnce({
        artifactId: 'capture-2',
        absolutePath: '/tmp/openforge/capture-2.png',
        mediaType: 'image/png',
        width: 640,
        height: 480,
        url: 'https://second.example/',
        title: 'Second page',
        capturedAt: '2026-08-11T14:31:00.000Z',
        dataUrl: 'data:image/png;base64,c2Vjb25k',
      })
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)
    api.tasks.get = vi.fn(async taskId => task(taskId))
    api.tasks.sendFollowUp = vi.fn(async request => ({
      taskId: request.taskId,
      sessionId: 'S-1',
      disposition: 'queued' as const,
    }))

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://first.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    expect(await screen.findByText('1 screenshot · 1 annotation')).toBeTruthy()

    const address = screen.getByRole('textbox', { name: 'Web address' })
    await fireEvent.input(address, { target: { value: 'https://second.example/' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    await waitFor(() => expect(surface.navigate).toHaveBeenCalledWith('https://second.example/'))
    vi.mocked(surface.selectVisibleRegion)
      .mockReset()
      .mockResolvedValueOnce({
        region: { x: 0.4, y: 0.4, width: 0.3, height: 0.3 },
        comment: 'Second state',
      })
      .mockResolvedValueOnce(null)
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    expect(await screen.findByText('2 screenshots · 2 annotations')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Review visual feedback' }))

    const review = screen.getByRole('region', { name: 'Visual feedback review' })
    expect(review.textContent?.indexOf('Capture 1')).toBeLessThan(review.textContent?.indexOf('Capture 2') ?? -1)
    expect(review.textContent).toContain('https://first.example/')
    expect(review.textContent).toContain('https://second.example/')

    await fireEvent.click(screen.getByRole('button', { name: 'Send visual feedback to agent' }))
    await waitFor(() => expect(api.tasks.sendFollowUp).toHaveBeenCalledTimes(1))
    const message = vi.mocked(api.tasks.sendFollowUp).mock.calls[0]?.[0].message ?? ''
    expect(message.indexOf('## Capture 1')).toBeLessThan(message.indexOf('## Capture 2'))
    expect(message).toContain('### Annotation 1')
    expect(message).toContain('### Annotation 2')
    await waitFor(() => expect(screen.queryByText('2 screenshots · 2 annotations')).toBeNull())
  })

  it('isolates pending review sessions by Task identity', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const firstSurface = createSurface('https://task-a.example/')
    const secondSurface = createSurface('https://task-b.example/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockImplementation(async request =>
      request.taskId === 'T-A' ? firstSurface : secondSurface)

    const view = render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://task-a.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    expect(await screen.findByText('1 screenshot · 1 annotation')).toBeTruthy()

    await view.rerender(props(api, 'T-B'))
    await screen.findByDisplayValue('https://task-b.example/')
    expect(screen.queryByText('1 screenshot · 1 annotation')).toBeNull()

    await view.rerender(props(api, 'T-A'))
    await screen.findByDisplayValue('https://task-a.example/')
    expect(screen.getByText('1 screenshot · 1 annotation')).toBeTruthy()
  })

  it('discards a stale capture result after the active Task changes', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const staleCapture = deferred<Awaited<ReturnType<TaskBrowserSurfaceController['captureVisibleViewport']>>>()
    const firstSurface = createSurface('https://task-a.example/')
    vi.mocked(firstSurface.captureVisibleViewport).mockReturnValue(staleCapture.promise)
    const secondSurface = createSurface('https://task-b.example/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockImplementation(async request =>
      request.taskId === 'T-A' ? firstSurface : secondSurface)

    const view = render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://task-a.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await waitFor(() => expect(firstSurface.captureVisibleViewport).toHaveBeenCalledTimes(1))

    await view.rerender(props(api, 'T-B'))
    await screen.findByDisplayValue('https://task-b.example/')
    staleCapture.resolve({
      artifactId: 'stale-capture',
      absolutePath: '/tmp/openforge/stale-capture.png',
      mediaType: 'image/png',
      width: 640,
      height: 480,
      url: 'https://task-a.example/',
      title: 'Task A',
      capturedAt: '2026-08-11T14:30:00.000Z',
      dataUrl: 'data:image/png;base64,c3RhbGU=',
    })

    await waitFor(() => expect(firstSurface.discardCapture).toHaveBeenCalledWith('stale-capture'))
    expect(screen.queryByText('1 screenshot · 1 annotation')).toBeNull()
  })

  it('edits saved comment text and normalized geometry without replacing the live Browser Surface', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)
    api.tasks.get = vi.fn(async taskId => task(taskId))
    api.tasks.sendFollowUp = vi.fn(async request => ({
      taskId: request.taskId,
      sessionId: 'S-1',
      disposition: 'delivered' as const,
    }))

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await screen.findByText('1 screenshot · 1 annotation')
    await fireEvent.click(screen.getByRole('button', { name: 'Review visual feedback' }))

    const comment = screen.getByRole('textbox', { name: 'Comment for annotation 1' })
    await fireEvent.input(comment, { target: { value: 'Corrected button alignment' } })
    await fireEvent.input(screen.getByRole('spinbutton', { name: 'Annotation 1 x' }), { target: { value: '0.25' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save annotation 1' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Send visual feedback to agent' }))

    await waitFor(() => expect(api.tasks.sendFollowUp).toHaveBeenCalledTimes(1))
    const message = vi.mocked(api.tasks.sendFollowUp).mock.calls[0]?.[0].message ?? ''
    expect(message).toContain('> Corrected button alignment')
    expect(message).toContain('Region: x=0.25, y=0.1, width=0.4, height=0.4')
    expect(surface.detach).not.toHaveBeenCalled()
    expect(surface.destroy).not.toHaveBeenCalled()
    expect(screen.queryByRole('img', { name: 'Captured browser viewport' })).toBeNull()
  })

  it('deletes a finding, supports one-step undo, and confirms complete session discard', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await screen.findByText('1 screenshot · 1 annotation')
    await fireEvent.click(screen.getByRole('button', { name: 'Review visual feedback' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Delete annotation 1' }))

    await waitFor(() => expect(screen.queryByText('1 screenshot · 1 annotation')).toBeNull())
    expect(surface.discardCapture).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: 'Undo last visual feedback change' }))
    expect(await screen.findByText('1 screenshot · 1 annotation')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Discard visual feedback' }))
    expect(screen.getByText('1 screenshot · 1 annotation')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Discard visual feedback' }))
    await waitFor(() => expect(screen.queryByText('1 screenshot · 1 annotation')).toBeNull())
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(surface.discardCapture).toHaveBeenCalledWith('capture-1')
    expect(surface.destroy).not.toHaveBeenCalled()
  })

  it('keeps edited feedback usable when draft persistence fails and retries the save', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    let saveAttempt = 0
    const storage: PluginStorageScope = {
      get: async <T extends JsonValue>() => null as T | null,
      set: async (key) => {
        if (key !== 'visualFeedbackDraftV1') return
        saveAttempt += 1
        if (saveAttempt === 2) throw new Error('disk full')
      },
      delete: async () => undefined,
    }
    vi.spyOn(api.storage, 'task').mockReturnValue(storage)
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await screen.findByText('1 screenshot · 1 annotation')
    await fireEvent.click(screen.getByRole('button', { name: 'Review visual feedback' }))
    await fireEvent.input(screen.getByRole('textbox', { name: 'Comment for annotation 1' }), {
      target: { value: 'Saved in memory first' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save annotation 1' }))

    const retry = await screen.findByRole('button', { name: 'Retry saving visual feedback' })
    expect(screen.getAllByText((content) => content.includes('Could not save visual feedback: disk full')).length).toBeGreaterThan(0)
    expect(saveAttempt).toBe(2)
    expect(screen.getByText('1 screenshot · 1 annotation')).toBeTruthy()
    await fireEvent.click(retry)
    await waitFor(() => expect(saveAttempt).toBe(3))
    expect(screen.queryByRole('button', { name: 'Retry saving visual feedback' })).toBeNull()
    expect(surface.replaceVisualFeedback).toHaveBeenLastCalledWith([expect.objectContaining({
      comment: 'Saved in memory first',
    })])
  })

  it('offers a retry when live marker synchronization fails', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    vi.mocked(surface.replaceVisualFeedback)
      .mockRejectedValueOnce(new Error('surface unavailable'))
      .mockResolvedValue(undefined)
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await screen.findByText('1 screenshot · 1 annotation')
    await fireEvent.click(screen.getByRole('button', { name: 'Review visual feedback' }))
    await fireEvent.input(screen.getByRole('textbox', { name: 'Comment for annotation 1' }), {
      target: { value: 'Keep this corrected marker' },
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save annotation 1' }))

    const retry = await screen.findByRole('button', { name: 'Retry saving visual feedback' })
    expect(screen.getAllByText((content) => content.includes('Could not save live marker changes: surface unavailable')).length).toBeGreaterThan(0)
    await fireEvent.click(retry)
    await waitFor(() => expect(surface.replaceVisualFeedback).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'Retry saving visual feedback' })).toBeNull()
  })

  it('persists failed artifact cleanup after sending so retry remains available', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    vi.mocked(surface.discardCapture).mockRejectedValue(new Error('capture locked'))
    const evidence = (artifactId: string, absolutePath: string) => ({
      artifactId,
      absolutePath,
      mediaType: 'image/png' as const,
      width: 640,
      height: 480,
      url: 'https://capture.example/',
      title: 'Capture page',
      capturedAt: '2026-08-11T14:30:00.000Z',
    })
    const draft: JsonValue = {
      version: 1,
      captures: [{ number: 1, evidence: evidence('active-capture', '/tmp/openforge/active.png') }],
      annotations: [{
        number: 1,
        captureNumber: 1,
        rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        comment: 'Send this finding',
      }],
      pendingArtifactDiscards: [{
        number: 2,
        evidence: evidence('pending-capture', '/tmp/openforge/pending.png'),
      }],
    }
    const savedDrafts: JsonValue[] = []
    const deleteDraft = vi.fn(async () => undefined)
    const storage: PluginStorageScope = {
      get: async <T extends JsonValue>() => draft as T,
      set: async (_key, value) => { savedDrafts.push(value) },
      delete: deleteDraft,
    }
    vi.spyOn(api.storage, 'task').mockReturnValue(storage)
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)
    api.tasks.sendFollowUp = vi.fn(async request => ({
      taskId: request.taskId,
      sessionId: 'S-cleanup',
      disposition: 'delivered' as const,
    }))

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByText('1 screenshot · 1 annotation')
    await fireEvent.click(screen.getByRole('button', { name: 'Send visual feedback to agent' }))

    await waitFor(() => expect(api.tasks.sendFollowUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(savedDrafts.at(-1)).toEqual(expect.objectContaining({
      annotations: [],
      pendingArtifactDiscards: [expect.objectContaining({
        evidence: expect.objectContaining({ artifactId: 'pending-capture' }),
      })],
    })))
    expect(deleteDraft).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Retry saving visual feedback' })).toBeTruthy()
  })

  it('restores feedback with a missing background capture as a per-finding warning', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    vi.mocked(surface.captureExists).mockResolvedValue(false)
    const draft: JsonValue = {
      version: 1,
      captures: [{
        number: 1,
        evidence: {
          artifactId: 'missing-capture',
          absolutePath: '/tmp/openforge/missing-capture.png',
          mediaType: 'image/png',
          width: 640,
          height: 480,
          url: 'https://capture.example/',
          title: 'Capture page',
          capturedAt: '2026-08-11T14:30:00.000Z',
        },
      }],
      annotations: [{
        number: 1,
        captureNumber: 1,
        rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        comment: 'Restored finding',
      }],
    }
    const storage: PluginStorageScope = {
      get: async <T extends JsonValue>() => draft as T,
      set: async () => undefined,
      delete: async () => undefined,
    }
    vi.spyOn(api.storage, 'task').mockReturnValue(storage)
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByText('1 screenshot · 1 annotation')
    await fireEvent.click(screen.getByRole('button', { name: 'Review visual feedback' }))

    expect(screen.getByRole('alert').textContent).toContain('Annotation 1 background unavailable')
    expect(screen.getByRole('alert').textContent).toContain('/tmp/openforge/missing-capture.png')
    expect(screen.getByText('1 screenshot · 1 annotation')).toBeTruthy()
    expect(surface.replaceVisualFeedback).toHaveBeenCalledWith([expect.objectContaining({
      annotationNumber: 1,
      comment: 'Restored finding',
    })])
  })
})
