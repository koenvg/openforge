import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { TaskFollowUpError } from '@openforge-app/plugin-sdk'
import { tick } from 'svelte'
import type {
  Disposable,
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
    selectVisibleRegion: vi.fn()
      .mockResolvedValueOnce({
        region: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        comment: 'Button alignment is off',
      })
      .mockResolvedValue(null),
    cancelVisibleRegionSelection: vi.fn(async () => undefined),
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
    summary: null,
    agent: 'worker',
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    handoff_notes_enabled: true,
    source_ticket_url: null,
    depends_on: [],
    project_id: 'P-1',
    created_at: 0,
    updated_at: 0,
  }
}

describe('TaskBrowserTab lifecycle', () => {
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
    expect(screen.getByText('1 comment')).toBeTruthy()
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
      disposition: 'queued',
    }))

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await screen.findByText('1 comment')

    const send = screen.getByRole('button', { name: 'Send visual feedback to agent' }) as HTMLButtonElement
    expect(send.disabled).toBe(false)
    await fireEvent.click(send)

    await waitFor(() => expect(api.tasks.sendFollowUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('1 comment')).toBeNull())
  })

  it('restores the feedback count and send action after leaving and reopening the Task Browser', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
    const surface = createSurface('https://capture.example/')
    vi.spyOn(api.browserSurfaces, 'getOrCreate').mockResolvedValue(surface)

    const firstView = render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')
    await fireEvent.click(screen.getByRole('button', { name: 'Add visual feedback' }))
    await screen.findByText('1 comment')
    firstView.unmount()

    render(TaskBrowserTab, { props: props(api, 'T-A') })
    await screen.findByDisplayValue('https://capture.example/')

    expect(screen.getByText('1 comment')).toBeTruthy()
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
    await screen.findByText('1 comment')

    const send = screen.getByRole('button', { name: 'Send visual feedback to agent' })
    await fireEvent.click(send)
    await fireEvent.click(send)

    expect(api.tasks.sendFollowUp).toHaveBeenCalledTimes(1)
    expect(api.tasks.sendFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'T-A',
      message: expect.stringContaining('PNG: `/tmp/openforge/capture-1.png`'),
    }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((send as HTMLButtonElement).disabled).toBe(true)

    delivery.resolve({ taskId: 'T-A', sessionId: 'S-1', disposition: 'queued' })
    await waitFor(() => expect(screen.queryByText('1 comment')).toBeNull())
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
    await screen.findByText('1 comment')

    await fireEvent.click(screen.getByRole('button', { name: 'Send visual feedback to agent' }))
    expect(await screen.findByText('No Agent Session exists for Task T-A')).toBeTruthy()
    expect(screen.getByText('1 comment')).toBeTruthy()
    expect(surface.discardCapture).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: 'Send visual feedback to agent' }))
    await waitFor(() => expect(screen.queryByText('1 comment')).toBeNull())
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
    await screen.findByText('1 comment')
    await fireEvent.click(screen.getByRole('button', { name: 'Send visual feedback to agent' }))

    const switching = view.rerender(props(api, 'T-B'))
    delivery.resolve({ taskId: 'T-A', sessionId: 'S-1', disposition: 'delivered' })
    await switching
    await screen.findByDisplayValue('https://task-b.example/')

    expect(firstSurface.discardCapture).not.toHaveBeenCalled()
    expect(api.tasks.sendFollowUp).toHaveBeenCalledTimes(1)
  })
})
