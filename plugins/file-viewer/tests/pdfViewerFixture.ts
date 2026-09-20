import '../../../src/app.css'
import { mount, unmount } from 'svelte'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import FileContentViewer from '../src/FileContentViewer.svelte'
import { createThemeDocumentAdapter } from '../../../src/lib/themeDocumentAdapter'
import { STUDIO_LIGHT } from '../../../src/lib/themes/studio'
createThemeDocumentAdapter(document.documentElement).apply(STUDIO_LIGHT)

/** Exercise the real dispatch, metadata header and navigation alongside PDF.js. */
export function mountPdfViewer(bytes: number[]) {
  const host = document.querySelector('#pdf') as HTMLDivElement
  host.className = ''
  host.style.cssText = 'display:flex;height:600px;flex-direction:column'
  const tree = document.createElement('button')
  tree.textContent = 'Selected file in tree'
  tree.id = 'fixture-tree-file'
  host.parentElement!.prepend(tree)
  const preview = mount(FileContentViewer, {
    target: host,
    props: {
      api: {} as FrontendOpenForgeAPI,
      content: { type: 'document', content: '', mimeType: 'application/pdf', size: bytes.length },
      fileName: 'project-guide.pdf', filePath: 'project-guide.pdf', error: null, modifiedAt: 1700000000000,
      workspaceSource: {
        identity: 'project:browser-fixture',
        readDirectory: async () => [], readFile: async () => { throw new Error('Unexpected ordinary file read') }, searchFiles: async () => [],
        readDocument: async () => ({ status: 'ready', mimeType: 'application/pdf', encoding: 'base64', data: btoa(String.fromCharCode(...bytes)), size: bytes.length, revision: 'fixture', modifiedAt: 1700000000000 }),
      },
      onReturnFocusToTree: () => tree.focus(),
    },
  })
  return () => { void unmount(preview); tree.remove() }
}
