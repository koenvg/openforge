import { describe, expect, it, vi } from 'vitest'

import { BrowserSurfaceError } from './browserSurfaces'
import { createMockBackendOpenForgeApi, createMockFrontendOpenForgeApi } from './testing'

describe('browser surfaces SDK contract', () => {
  it('provides an idempotent frontend testing fake with state, navigation, attachment, and lifecycle calls', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'browser', projectId: 'P-1' })
    const first = await api.browserSurfaces.getOrCreate({
      taskId: 'T-1',
      id: 'main',
      initialUrl: 'https://example.com/first',
    })
    const second = await api.browserSurfaces.getOrCreate({
      taskId: 'T-1',
      id: 'main',
      initialUrl: 'https://example.com/ignored',
    })

    expect(second).toBe(first)
    await expect(first.getState()).resolves.toMatchObject({
      url: 'https://example.com/first',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
    })

    const states: string[] = []
    const subscription = first.onStateChanged(state => states.push(state.url))
    const attachment = await first.attach(document.createElement('div'))
    await first.navigate('https://example.com/second')
    await first.goBack()
    await first.goForward()
    await first.reload()
    await first.stop()
    await attachment.dispose()

    api.__testing.registry.setBrowserSurfaceState('T-1', 'main', { title: 'Driven by test' })
    expect((await first.getState()).title).toBe('Driven by test')
    expect(states).toContain('https://example.com/second')

    await subscription.dispose()
    await first.destroy()

    expect(api.__testing.calls.browserSurfaceGetOrCreate).toEqual([
      { taskId: 'T-1', id: 'main', initialUrl: 'https://example.com/first' },
      { taskId: 'T-1', id: 'main', initialUrl: 'https://example.com/ignored' },
    ])
    expect(api.__testing.calls.browserSurfaceAttachments).toHaveLength(1)
    expect(api.__testing.calls.browserSurfaceNavigations).toEqual([
      { taskId: 'T-1', id: 'main', url: 'https://example.com/second' },
    ])
    expect(api.__testing.calls.browserSurfaceDetaches).toEqual([{ taskId: 'T-1', id: 'main' }])
    expect(api.__testing.calls.browserSurfaceDestroys).toEqual([{ taskId: 'T-1', id: 'main' }])
    await expect(first.getState()).rejects.toMatchObject({
      name: 'BrowserSurfaceError',
      code: 'SURFACE_DESTROYED',
    })
  })

  it('supports blank initial state, navigation errors, and Task Browser Session reset in tests', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'browser' })
    const surface = await api.browserSurfaces.getOrCreate({ taskId: 'T-2', id: 'main' })

    expect((await surface.getState()).url).toBe('about:blank')
    await expect(surface.navigate('file:///tmp/secret')).rejects.toBeInstanceOf(BrowserSurfaceError)
    await expect(surface.navigate('file:///tmp/secret')).rejects.toMatchObject({ code: 'INVALID_URL' })

    await api.browserSurfaces.resetSession('T-2')
    expect(api.__testing.calls.browserSurfaceSessionResets).toEqual([{ taskId: 'T-2' }])
    await expect(surface.getState()).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
  })

  it('keeps browser surfaces unavailable to backend plugin APIs', () => {
    const backend = createMockBackendOpenForgeApi()
    expect(backend).not.toHaveProperty('browserSurfaces')
    expect(vi.fn()).not.toHaveBeenCalled()
  })
})
