import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { get } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge/plugin-sdk/frontend'
import { isOpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge/plugin-sdk/frontend'

const { mockFilesView } = vi.hoisted(() => ({
  mockFilesView: { name: 'FilesViewComponent' },
}))

vi.mock('./FilesView.svelte', () => ({
  default: mockFilesView,
}))

import packageJson from '../package.json'
import { pendingFileReveal } from './lib/stores'

const pluginSrcDir = dirname(fileURLToPath(import.meta.url))

function makeRuntimeHarness() {
  const subscriptions = { add: vi.fn() }
  const invokeGlobal = vi.fn()
  const registerCommand = vi.fn(() => ({ dispose: vi.fn() }))
  const api = {
    views: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    commands: { register: registerCommand, invokeGlobal },
    system: { openUrl: vi.fn() },
  } as unknown as FrontendOpenForgeAPI
  const context = {
    pluginId: packageJson.openforge.id,
    apiVersion: 1,
    packageMetadata: packageJson.openforge,
    subscriptions,
  } as FrontendPluginContext

  return { api, context, subscriptions, invokeGlobal, registerCommand }
}

describe('file-viewer plugin', () => {
  it('does not retain stale host PluginContext state in the file viewer plugin entry', () => {
    const indexSource = readFileSync(join(pluginSrcDir, 'index.ts'), 'utf8')

    expect(indexSource).not.toContain('./pluginContext')
    expect(indexSource).not.toContain('setPluginContext')
    expect(existsSync(join(pluginSrcDir, 'pluginContext.ts'))).toBe(false)
  })

  it('has valid package.json#openforge metadata without manifest contributions', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge).not.toHaveProperty('contributes')
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
  })

  it('registers the Files view at runtime through defineFrontendPlugin', async () => {
    const { default: plugin, FilesViewComponent } = await import('./index')
    const { api, context, subscriptions } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expect(plugin[OPENFORGE_FRONTEND_PLUGIN_MARKER]).toBe(true)
    expect(api.views.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'files',
      title: 'Files',
      icon: 'folder-open',
      placement: 'rail',
      order: 10,
      component: FilesViewComponent,
    }))
    expect(FilesViewComponent).toBe(mockFilesView)
    expect(subscriptions.add).toHaveBeenCalledWith(expect.objectContaining({ dispose: expect.any(Function) }))
  })

  it('registers a plugin-owned revealFile command that updates reveal state', async () => {
    pendingFileReveal.set(null)
    const { default: plugin, FILE_VIEWER_REVEAL_FILE_COMMAND_ID } = await import('./index')
    const { api, context, registerCommand, subscriptions } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expect(FILE_VIEWER_REVEAL_FILE_COMMAND_ID).toBe('revealFile')
    expect(registerCommand).toHaveBeenCalledWith(expect.objectContaining({
      id: 'revealFile',
      title: 'Reveal File',
      input: expect.objectContaining({
        type: 'object',
        required: ['path'],
      }),
      handler: expect.any(Function),
    }))

    const registration = registerCommand.mock.calls[0]?.[0]
    await registration.handler({ path: 'src/lib/fileViewerPlugin.ts' })

    expect(get(pendingFileReveal)).toBe('src/lib/fileViewerPlugin.ts')
    expect(subscriptions.add).toHaveBeenCalledTimes(2)
  })

  it('does not keep plugin-local runtime adapter modules or imports', () => {
    const filesViewSource = readFileSync(join(pluginSrcDir, 'FilesView.svelte'), 'utf8')
    const fileContentViewerSource = readFileSync(join(pluginSrcDir, 'FileContentViewer.svelte'), 'utf8')

    expect(existsSync(join(pluginSrcDir, 'lib/ipc.ts'))).toBe(false)
    expect(filesViewSource).not.toContain('./lib/ipc')
    expect(fileContentViewerSource).not.toContain('./lib/ipc')
  })
})
