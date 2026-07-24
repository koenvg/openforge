import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
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
})
