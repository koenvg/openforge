import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'vite'
import {
  COLLAPSED_SECTIONS_STORAGE_KEY,
  pluginSectionKey,
  type CollapsedSectionsState,
} from './collapsibleSectionState'

interface BundleStateApi {
  clearCollapsedSections(): void
  getCollapsedSections(): CollapsedSectionsState
  setSectionCollapsed(key: string, collapsed: boolean): void
}

const bundleNames = ['host', 'plugin-a', 'plugin-b'] as const
let fixtureRoot: string
let bundles: Record<(typeof bundleNames)[number], BundleStateApi>

async function buildIndependentBundle(name: (typeof bundleNames)[number]): Promise<BundleStateApi> {
  const entryPath = path.join(fixtureRoot, `${name}.ts`)
  const stateModulePath = new URL('./collapsibleSectionState.ts', import.meta.url).pathname

  await writeFile(entryPath, `
    import { get } from 'svelte/store'
    import {
      clearCollapsedSections,
      collapsedSections,
      setSectionCollapsed,
    } from ${JSON.stringify(stateModulePath)}

    export { clearCollapsedSections, setSectionCollapsed }
    export function getCollapsedSections() {
      return get(collapsedSections)
    }
  `)

  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      emptyOutDir: false,
      lib: {
        entry: entryPath,
        formats: ['es'],
        fileName: () => 'index.js',
      },
      minify: false,
      write: false,
    },
  })
  const outputs = Array.isArray(result) ? result.flatMap(({ output }) => output) : result.output
  const chunk = outputs.find((output) => output.type === 'chunk')
  if (chunk?.type !== 'chunk') throw new Error(`Bundle ${name} produced no JavaScript chunk`)

  return import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`) as Promise<BundleStateApi>
}

describe('collapsible section state across independent bundles', () => {
  beforeAll(async () => {
    fixtureRoot = await mkdtemp(path.join(process.cwd(), '.collapsible-section-test-'))
    const [host, pluginA, pluginB] = await Promise.all(bundleNames.map(buildIndependentBundle))
    bundles = { host, 'plugin-a': pluginA, 'plugin-b': pluginB }
  }, 30_000)

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true })
  })

  it('shares live state and preserves unrelated keys written by the host and two plugins', () => {
    localStorage.clear()
    bundles.host.clearCollapsedSections()

    const hostKey = 'details'
    const pluginAKey = pluginSectionKey('plugin-a', 'details')
    const pluginBKey = pluginSectionKey('plugin-b', 'details')

    bundles.host.setSectionCollapsed(hostKey, true)
    bundles['plugin-a'].setSectionCollapsed(pluginAKey, true)
    bundles['plugin-b'].setSectionCollapsed(pluginBKey, true)

    const expected = {
      [hostKey]: true,
      [pluginAKey]: true,
      [pluginBKey]: true,
    }

    expect(bundles.host.getCollapsedSections()).toEqual(expected)
    expect(bundles['plugin-a'].getCollapsedSections()).toEqual(expected)
    expect(bundles['plugin-b'].getCollapsedSections()).toEqual(expected)
    expect(JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY) as string)).toEqual(expected)
  })
})
