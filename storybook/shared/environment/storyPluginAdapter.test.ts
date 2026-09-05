import { afterEach, describe, expect, it } from 'vitest'
import { createTextFileContent } from '../fixtures/appFixtures'
import { createStoryPluginAdapter } from './storyPluginAdapter'

const adapters: Array<{ dispose(): void | Promise<void> }> = []

afterEach(async () => {
  for (const adapter of adapters.splice(0).reverse()) await adapter.dispose()
})

describe('StoryPluginAdapter', () => {
  it('provides a frontend plugin API and matching context', async () => {
    const adapter = createStoryPluginAdapter({
      pluginId: 'com.openforge.story-fixture',
      projectId: 'P-1',
      taskId: 'T-1',
      projectFileContents: { 'README.md': createTextFileContent({ content: '# OpenForge' }) },
    })
    adapters.push(adapter)
    adapter.install()

    expect(adapter.context).toMatchObject({
      pluginId: 'com.openforge.story-fixture',
      projectId: 'P-1',
      taskId: 'T-1',
    })
    await adapter.api.system.openUrl('https://example.com/design')
    await expect(adapter.api.fs.readFile({ projectId: 'P-1', path: 'README.md' }))
      .resolves.toMatchObject({ type: 'text', content: '# OpenForge' })
    expect(adapter.calls.openUrl).toEqual(['https://example.com/design'])
  })

  it('uses the SDK browser-surface fake', async () => {
    const adapter = createStoryPluginAdapter({ taskId: 'T-browser' })
    adapters.push(adapter)
    adapter.install()

    const browser = await adapter.api.browserSurfaces.getOrCreate({
      taskId: 'T-browser',
      id: 'main',
      initialUrl: 'https://example.com/first',
    })
    await browser.navigate('https://example.com/second')
    adapter.setBrowserSurfaceState('T-browser', 'main', {
      title: 'Design preview',
      loading: false,
    })

    await expect(browser.getState()).resolves.toMatchObject({
      url: 'https://example.com/second',
      title: 'Design preview',
    })
    expect(adapter.calls.browserSurfaceNavigations).toEqual([
      { taskId: 'T-browser', id: 'main', url: 'https://example.com/second' },
    ])
  })

  it('records deterministic terminal operations without a PTY', async () => {
    const adapter = createStoryPluginAdapter({ taskId: 'T-terminal' })
    adapters.push(adapter)
    adapter.install()

    await adapter.api.shell.spawn({
      taskId: 'T-terminal',
      terminalIndex: 1,
      cwd: '/worktree',
      cols: 100,
      rows: 30,
      terminalImageProtocol: null,
    })
    await adapter.api.shell.write({ taskId: 'T-terminal', terminalIndex: 1, data: 'pnpm test\n' })
    await expect(adapter.api.shell.getBuffer({
      taskId: 'T-terminal',
      terminalIndex: 1,
    })).resolves.toEqual({ buffer: null, isLive: false, instanceId: null })

    expect(adapter.calls.shellSpawns).toHaveLength(1)
    expect(adapter.calls.shellWrites).toEqual([
      { taskId: 'T-terminal', terminalIndex: 1, data: 'pnpm test\n' },
    ])
  })

  it('recreates plugin state and calls on reset', async () => {
    const adapter = createStoryPluginAdapter({ pluginId: 'resettable' })
    adapters.push(adapter)
    adapter.install()
    const firstApi = adapter.api
    await firstApi.storage.global.set('draft', 'changed')

    await adapter.reset()

    expect(adapter.api).not.toBe(firstApi)
    await expect(adapter.api.storage.global.get('draft')).resolves.toBeNull()
    expect(adapter.calls.storageSets).toEqual([])
  })
})
