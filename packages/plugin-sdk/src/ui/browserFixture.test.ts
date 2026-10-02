// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { createSdkBrowserFixture } from '../../test/browserFixture'

const resources = vi.hoisted(() => ({
  mkdtemp: vi.fn(), rm: vi.fn(), createServer: vi.fn(), launch: vi.fn(),
  listen: vi.fn(), serverClose: vi.fn(), browserClose: vi.fn(),
  newPage: vi.fn(), pageClose: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({ mkdtemp: resources.mkdtemp, rm: resources.rm }))
vi.mock('vite', () => ({ createServer: resources.createServer }))
vi.mock('playwright', () => ({ chromium: { launch: resources.launch } }))
vi.mock('@sveltejs/vite-plugin-svelte', () => ({ svelte: () => ({ name: 'svelte' }) }))

beforeEach(() => {
  vi.resetAllMocks()
  resources.mkdtemp.mockResolvedValue('/tmp/sdk-fixture')
  resources.rm.mockResolvedValue(undefined)
  resources.listen.mockResolvedValue(undefined)
  resources.serverClose.mockResolvedValue(undefined)
  resources.browserClose.mockResolvedValue(undefined)
  resources.pageClose.mockResolvedValue(undefined)
  resources.createServer.mockResolvedValue({
    listen: resources.listen, close: resources.serverClose,
    resolvedUrls: { local: ['http://127.0.0.1:1234/'] },
  })
  resources.newPage.mockResolvedValue({ close: resources.pageClose, isClosed: () => false })
  resources.launch.mockResolvedValue({ close: resources.browserClose, newPage: resources.newPage })
})

it('still closes the server and removes its isolated cache when Chromium close fails', async () => {
  const fixture = await createSdkBrowserFixture({ entries: ['fixture.html'] })
  const failure = new Error('Chromium close failed')
  resources.browserClose.mockRejectedValue(failure)

  await expect(fixture.close()).rejects.toThrow(failure)

  expect(resources.serverClose).toHaveBeenCalledOnce()
  expect(resources.rm).toHaveBeenCalledWith('/tmp/sdk-fixture', { recursive: true, force: true })
})

it('still releases every resource when a page close fails', async () => {
  const fixture = await createSdkBrowserFixture({ entries: ['fixture.html'] })
  await fixture.newPage({ viewport: { width: 320, height: 480 } })
  const failure = new Error('Page close failed')
  resources.pageClose.mockRejectedValue(failure)

  await expect(fixture.close()).rejects.toThrow(failure)

  expect(resources.browserClose).toHaveBeenCalledOnce()
  expect(resources.serverClose).toHaveBeenCalledOnce()
  expect(resources.rm).toHaveBeenCalledOnce()
})

it.each(['cache', 'server', 'listen', 'launch'] as const)('rolls back acquired resources after %s setup fails', async (stage) => {
  const failure = new Error(`${stage} failed`)
  const operation = { cache: resources.mkdtemp, server: resources.createServer, listen: resources.listen, launch: resources.launch }[stage]
  operation.mockRejectedValue(failure)

  await expect(createSdkBrowserFixture({ entries: ['fixture.html'] })).rejects.toThrow(failure)

  expect(resources.browserClose).not.toHaveBeenCalled()
  expect(resources.serverClose).toHaveBeenCalledTimes(stage === 'listen' || stage === 'launch' ? 1 : 0)
  expect(resources.rm).toHaveBeenCalledTimes(stage === 'cache' ? 0 : 1)
})

it('preserves the setup error when rollback also fails', async () => {
  const setupError = new Error('Launch failed')
  const cleanupError = new Error('Server close failed')
  resources.launch.mockRejectedValue(setupError)
  resources.serverClose.mockRejectedValue(cleanupError)

  const error = await createSdkBrowserFixture({ entries: ['fixture.html'] }).catch(error => error)

  expect(error).toBeInstanceOf(AggregateError)
  expect(error.cause).toBe(setupError)
  expect(error.errors).toEqual([setupError, cleanupError])
  expect(resources.rm).toHaveBeenCalledOnce()
})

it('reports every cleanup failure in release order and only closes once', async () => {
  const fixture = await createSdkBrowserFixture({ entries: ['fixture.html'] })
  await fixture.newPage()
  const errors = ['page', 'browser', 'server', 'cache'].map(name => new Error(name))
  resources.pageClose.mockRejectedValue(errors[0])
  resources.browserClose.mockRejectedValue(errors[1])
  resources.serverClose.mockRejectedValue(errors[2])
  resources.rm.mockRejectedValue(errors[3])

  const first = fixture.close()
  const second = fixture.close()
  expect(second).toBe(first)
  const error = await first.catch(error => error)
  expect(error).toBeInstanceOf(AggregateError)
  expect(error.errors).toEqual(errors)
  expect(resources.pageClose).toHaveBeenCalledOnce()
  expect(resources.browserClose).toHaveBeenCalledOnce()
  expect(resources.serverClose).toHaveBeenCalledOnce()
  expect(resources.rm).toHaveBeenCalledOnce()
})

it('uses explicit optimizer entries and defaults to alias-free public exports', async () => {
  const fixture = await createSdkBrowserFixture({ entries: ['first.html', 'second.html'] })
  const [config] = resources.createServer.mock.calls[0]
  expect(config.optimizeDeps.entries).toEqual(['first.html', 'second.html'])
  expect(config.resolve).toBeUndefined()
  expect(config.cacheDir).toBe('/tmp/sdk-fixture')
  expect(config.configFile).toBe(false)
  expect(fixture.origin).toBe('http://127.0.0.1:1234/')
  await fixture.close()
})

it('allocates isolated caches and only enables source aliases when requested', async () => {
  resources.mkdtemp.mockResolvedValueOnce('/tmp/first-sdk').mockResolvedValueOnce('/tmp/second-sdk')
  const first = await createSdkBrowserFixture({ entries: ['fixture.html'], sourceAliases: true })
  const second = await createSdkBrowserFixture({ entries: ['fixture.html'] })
  const configs = resources.createServer.mock.calls.map(([config]) => config)
  expect(configs.map(config => config.cacheDir)).toEqual(['/tmp/first-sdk', '/tmp/second-sdk'])
  expect(configs[0].resolve.alias['@openforge-app/plugin-sdk/ui/SplitButton.svelte']).toMatch(/\/src\/ui\/SplitButton\.svelte$/)
  expect(configs[1].resolve).toBeUndefined()
  await first.close()
  await second.close()
})

it('releases the fixture even when creating a page fails', async () => {
  const fixture = await createSdkBrowserFixture({ entries: ['fixture.html'] })
  resources.newPage.mockRejectedValue(new Error('Page startup failed'))
  try {
    await expect(fixture.newPage()).rejects.toThrow('Page startup failed')
  } finally {
    await fixture.close()
  }
  expect(resources.browserClose).toHaveBeenCalledOnce()
  expect(resources.serverClose).toHaveBeenCalledOnce()
  expect(resources.rm).toHaveBeenCalledOnce()
})

it('waits for an in-flight page acquisition before releasing its browser', async () => {
  const fixture = await createSdkBrowserFixture({ entries: ['fixture.html'] })
  let finishPage!: (page: { close: typeof resources.pageClose; isClosed: () => boolean }) => void
  resources.newPage.mockImplementation(() => new Promise(resolve => { finishPage = resolve }))
  const creating = fixture.newPage()
  const closing = fixture.close()

  expect(resources.browserClose).not.toHaveBeenCalled()
  finishPage({ close: resources.pageClose, isClosed: () => false })
  await creating
  await closing

  expect(resources.pageClose).toHaveBeenCalledOnce()
  expect(resources.browserClose).toHaveBeenCalledOnce()
})

it('does not re-close pages the consumer has already closed', async () => {
  resources.newPage.mockResolvedValue({ close: resources.pageClose, isClosed: () => true })
  const fixture = await createSdkBrowserFixture({ entries: ['fixture.html'] })
  await fixture.newPage({ reducedMotion: 'reduce' })
  expect(resources.newPage).toHaveBeenCalledWith({ reducedMotion: 'reduce' })
  await fixture.close()
  await fixture.close()

  expect(resources.pageClose).not.toHaveBeenCalled()
  expect(resources.browserClose).toHaveBeenCalledOnce()
  await expect(fixture.newPage()).rejects.toThrow('fixture is closing')
})
