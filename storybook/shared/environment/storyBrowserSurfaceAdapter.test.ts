import { createMockFrontendOpenForgeApi } from '@openforge-app/plugin-sdk/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { createStoryBrowserSurfaceAdapter } from './storyBrowserSurfaceAdapter'

const adapters: Array<{ dispose(): void | Promise<void> }> = []

afterEach(async () => {
  for (const adapter of adapters.splice(0).reverse()) await adapter.dispose()
})

describe('StoryBrowserSurfaceAdapter', () => {
  it('attaches a deterministic local page and follows navigation state', async () => {
    const base = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const adapter = createStoryBrowserSurfaceAdapter(
      base.browserSurfaces,
      (taskId, id, patch) => base.__testing.registry.setBrowserSurfaceState(taskId, id, patch),
      {
        initialUrl: 'https://catalog.openforge.local/tasks/T-42',
        title: 'OpenForge catalog',
        page: {
          eyebrow: 'Local browser fixture',
          heading: 'Task implementation preview',
          body: 'This page is attached by the browser-surface testing adapter.',
        },
      },
    )
    adapters.push(adapter)

    const surface = await adapter.api.getOrCreate({ taskId: 'T-42', id: 'main' })
    const host = document.createElement('div')
    const attachment = await surface.attach(host)

    expect(host.querySelector('[data-story-browser-surface="attached"]')).toBeTruthy()
    expect(host.textContent).toContain('Task implementation preview')
    expect(host.textContent).toContain('https://catalog.openforge.local/tasks/T-42')

    await surface.navigate('https://catalog.openforge.local/review')
    expect(host.textContent).toContain('https://catalog.openforge.local/review')
    expect(base.__testing.calls.browserSurfaceNavigations).toEqual([{
      taskId: 'T-42',
      id: 'main',
      url: 'https://catalog.openforge.local/review',
    }])

    await attachment.dispose()
    expect(host.childElementCount).toBe(0)
    expect(base.__testing.calls.browserSurfaceDetaches).toEqual([{ taskId: 'T-42', id: 'main' }])
  })

  it('renders empty, loading, and failed surface states without a network page', async () => {
    const cases = [
      [{ initialUrl: null }, 'No page loaded'],
      [{ initialUrl: 'https://catalog.openforge.local/', state: { loading: true } }, 'Loading preview…'],
      [{
        initialUrl: 'https://catalog.openforge.local/',
        state: { error: { code: 'LOAD_FAILED', message: 'Preview process disconnected', url: 'https://catalog.openforge.local/' } },
      }, 'Preview process disconnected'],
    ] as const

    for (const [definition, expected] of cases) {
      const base = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
      const adapter = createStoryBrowserSurfaceAdapter(
        base.browserSurfaces,
        (taskId, id, patch) => base.__testing.registry.setBrowserSurfaceState(taskId, id, patch),
        definition,
      )
      adapters.push(adapter)
      const surface = await adapter.api.getOrCreate({ taskId: 'T-state', id: 'main' })
      const host = document.createElement('div')
      await surface.attach(host)
      expect(host.textContent).toContain(expected)
    }
  })

  it('models a disconnected host and a retryable connection', async () => {
    const base = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const adapter = createStoryBrowserSurfaceAdapter(
      base.browserSurfaces,
      (taskId, id, patch) => base.__testing.registry.setBrowserSurfaceState(taskId, id, patch),
      { connectionFailures: 1, connectionError: 'Browser runtime disconnected' },
    )
    adapters.push(adapter)

    await expect(adapter.api.getOrCreate({ taskId: 'T-retry', id: 'main' }))
      .rejects.toThrow('Browser runtime disconnected')
    await expect(adapter.api.getOrCreate({ taskId: 'T-retry', id: 'main' }))
      .resolves.toBeTruthy()
  })

  it('ends configured visual-feedback selection and releases attachments on dispose', async () => {
    const base = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const adapter = createStoryBrowserSurfaceAdapter(
      base.browserSurfaces,
      (taskId, id, patch) => base.__testing.registry.setBrowserSurfaceState(taskId, id, patch),
      { selectionComments: ['Align the primary action', 'Increase the panel contrast'] },
    )
    adapters.push(adapter)

    const surface = await adapter.api.getOrCreate({ taskId: 'T-feedback', id: 'main' })
    const host = document.createElement('div')
    await surface.attach(host)

    await expect(surface.selectVisibleRegion()).resolves.toMatchObject({ comment: 'Align the primary action' })
    await expect(surface.selectVisibleRegion()).resolves.toMatchObject({ comment: 'Increase the panel contrast' })
    await expect(surface.selectVisibleRegion()).resolves.toBeNull()

    await adapter.dispose()
    expect(host.childElementCount).toBe(0)
    expect(base.__testing.calls.browserSurfaceSelections).toHaveLength(2)
  })
})
