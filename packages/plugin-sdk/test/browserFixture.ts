import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createOpenForgePluginSdkSourceAliasRecord } from '../src/vite'

interface BrowserFixtureOptions {
  entries: [string, ...string[]]
  sourceAliases?: boolean
}

/** Test-only owner. Register resources as soon as acquired, before fallible setup. */
export async function createSdkBrowserFixture({ entries, sourceAliases = false }: BrowserFixtureOptions) {
  const cleanup: Array<() => Promise<unknown>> = []
  let closing: Promise<void> | undefined
  function close() {
    return closing ??= (async () => {
      const errors: unknown[] = []
      for (const release of cleanup.splice(0).reverse()) {
        try { await release() } catch (error) { errors.push(error) }
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'SDK browser fixture cleanup failed')
    })()
  }

  try {
    // Parallel fixture servers must not invalidate each other's optimized dependencies.
    const cacheDir = await mkdtemp(resolve(tmpdir(), 'openforge-sdk-browser-'))
    cleanup.push(() => rm(cacheDir, { recursive: true, force: true }))
    const repositoryRoot = new URL('../../../', import.meta.url)
    const server = await createServer({
      configFile: false,
      root: resolve(import.meta.dirname, '../../..'),
      cacheDir,
      plugins: [svelte()],
      optimizeDeps: { entries },
      ...(sourceAliases ? { resolve: { alias: createOpenForgePluginSdkSourceAliasRecord(repositoryRoot) } } : {}),
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 0 },
    })
    cleanup.push(() => server.close())
    await server.listen()
    const origin = server.resolvedUrls?.local[0]
    if (!origin) throw new Error('SDK browser fixture server has no local URL')
    const browser = await chromium.launch({ headless: true })
    cleanup.push(() => browser.close())
    async function newPage(options?: Parameters<typeof browser.newPage>[0]) {
      if (closing) throw new Error('SDK browser fixture is closing')
      const creating = browser.newPage(options)
      // Own pending acquisition too, so teardown cannot overtake page creation.
      cleanup.push(async () => {
        const page = await creating.catch(() => undefined)
        if (page && !page.isClosed()) await page.close()
      })
      return creating
    }
    return { newPage, origin, close }
  } catch (error) {
    try { await close() } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'SDK browser fixture setup and cleanup failed', { cause: error })
    }
    throw error
  }
}

export type SdkBrowserFixture = Awaited<ReturnType<typeof createSdkBrowserFixture>>
