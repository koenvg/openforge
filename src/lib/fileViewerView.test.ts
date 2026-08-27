import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makePluginViewKey } from './plugin/types'
import { FILE_VIEWER_PLUGIN_ID, FILE_VIEWER_VIEW_ID, FILE_VIEWER_VIEW_KEY } from './fileViewerView'

describe('file viewer view identity', () => {
  it('exposes the canonical built-in File Viewer view key', () => {
    expect(FILE_VIEWER_PLUGIN_ID).toBe('com.openforge.file-viewer')
    expect(FILE_VIEWER_VIEW_ID).toBe('files')
    expect(FILE_VIEWER_VIEW_KEY).toBe(makePluginViewKey(FILE_VIEWER_PLUGIN_ID, FILE_VIEWER_VIEW_ID))
  })

  it('does not depend on the plugin activation lifecycle', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/fileViewerView.ts'), 'utf8')

    expect(source).not.toContain('pluginActivationLifecycle')
  })
})
