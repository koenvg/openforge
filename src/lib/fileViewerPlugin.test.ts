import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FILE_VIEWER_PLUGIN_ID } from './fileViewerView'

const executePluginCommandMock = vi.hoisted(() => vi.fn())

vi.mock('./plugin/pluginActivationLifecycle', () => ({
  executePluginCommand: executePluginCommandMock,
}))

describe('fileViewerPlugin host bridge', () => {
  it('reveals files through the generic plugin command primitive', async () => {
    executePluginCommandMock.mockResolvedValueOnce(true)
    const { FILE_VIEWER_REVEAL_FILE_COMMAND_ID, revealFileInFileViewer } = await import('./fileViewerPlugin')

    await expect(revealFileInFileViewer('src/App.svelte')).resolves.toBe(true)

    expect(FILE_VIEWER_REVEAL_FILE_COMMAND_ID).toBe('revealFile')
    expect(executePluginCommandMock).toHaveBeenCalledWith(FILE_VIEWER_PLUGIN_ID, 'revealFile', {
      path: 'src/App.svelte',
    })
  })

  it('does not import file-viewer plugin internals into the host bridge', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/fileViewerPlugin.ts'), 'utf8')

    expect(source).not.toContain('plugins/file-viewer/src/lib/stores')
    expect(source).not.toContain('requestFileReveal')
  })
})
