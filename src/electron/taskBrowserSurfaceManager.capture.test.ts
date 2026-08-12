import { describe, expect, it } from 'vitest'

import { createTaskBrowserSurfaceManagerFixture } from './taskBrowserSurfaceManager.testUtils'

async function liveCaptureFixture() {
  const fixture = createTaskBrowserSurfaceManagerFixture()
  const reference = await fixture.manager.getOrCreate({
    windowId: 10,
    pluginId: 'browser',
    taskId: 'T-1',
    id: 'main',
  })
  fixture.manager.attach(reference.surfaceId, 'attachment-1', 1, { x: 0, y: 0, width: 800, height: 600 })
  return { ...fixture, reference }
}

describe('Task Browser Surface viewport capture', () => {
  it('reauthorizes live-region selection and the exact capture generation', async () => {
    const { manager, factory, artifacts, authorize, reference } = await liveCaptureFixture()
    factory.surfaces[0].emit({ url: 'https://example.test/account', title: 'Account settings' })
    const owner = {
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-1',
      surfaceId: reference.surfaceId,
      generation: reference.generation,
    }

    await expect(manager.selectVisibleRegion(owner)).resolves.toEqual({
      region: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
      comment: 'Example visual feedback',
    })
    const capture = await manager.captureVisibleViewport(owner)

    expect(authorize).toHaveBeenCalledTimes(3)
    expect(factory.surfaces[0].captureCalls).toEqual([{}])
    expect(artifacts.store).toHaveBeenCalledWith({
      pluginId: 'browser',
      taskId: 'T-1',
      png: Buffer.from('fake-visible-png'),
    })
    expect(capture).toEqual({
      artifactId: '11111111-1111-4111-8111-111111111111',
      absolutePath: '/tmp/openforge/task-browser/capture.png',
      mediaType: 'image/png',
      width: 800,
      height: 600,
      url: 'https://example.test/account',
      title: 'Account settings',
      capturedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      dataUrl: `data:image/png;base64,${Buffer.from('fake-visible-png').toString('base64')}`,
    })
  })

  it.each([
    ['another window', { windowId: 11 }, 'SURFACE_ACCESS_DENIED'],
    ['another plugin', { pluginId: 'other' }, 'SURFACE_ACCESS_DENIED'],
    ['another Task', { taskId: 'T-2' }, 'SURFACE_ACCESS_DENIED'],
    ['a stale generation', { generation: 999 }, 'SURFACE_DESTROYED'],
  ])('rejects capture through %s', async (_label, patch, code) => {
    const { manager, reference } = await liveCaptureFixture()

    await expect(manager.captureVisibleViewport({
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-1',
      surfaceId: reference.surfaceId,
      generation: reference.generation,
      ...patch,
    })).rejects.toMatchObject({ code })
  })

  it('rejects destroyed references and scopes discard through the same exact owner', async () => {
    const { manager, artifacts, reference } = await liveCaptureFixture()
    const owner = {
      windowId: 10,
      pluginId: 'browser',
      taskId: 'T-1',
      surfaceId: reference.surfaceId,
      generation: reference.generation,
    }

    await manager.discardCapture({ ...owner, artifactId: '11111111-1111-4111-8111-111111111111' })
    expect(artifacts.discard).toHaveBeenCalledWith({
      pluginId: 'browser',
      taskId: 'T-1',
      artifactId: '11111111-1111-4111-8111-111111111111',
    })

    await manager.destroy(reference.surfaceId)
    await expect(manager.captureVisibleViewport(owner)).rejects.toMatchObject({ code: 'SURFACE_DESTROYED' })
  })
})
