import '../../../src/app.css'
import { mount, unmount } from 'svelte'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import FileContentViewer from '../src/FileContentViewer.svelte'
import { createProjectWorkspaceSource, createTaskWorkspaceSource } from '../src/lib/workspaceSource'
import { createThemeDocumentAdapter } from '../../../src/lib/themeDocumentAdapter'
import { STUDIO_LIGHT } from '../../../src/lib/themes/studio'
createThemeDocumentAdapter(document.documentElement).apply(STUDIO_LIGHT)

/** Exercise the real dispatch, metadata header and navigation alongside PDF.js. */
export function mountPdfViewer(bytes: number[], scope: 'project' | 'task' = 'project') {
  const readDocument = async () => ({ status: 'ready' as const, mimeType: 'application/pdf' as const, encoding: 'base64' as const, data: btoa(String.fromCharCode(...bytes)), size: bytes.length, revision: 'fixture', modifiedAt: 1700000000000 })
  const wrongScope = async () => { throw new Error('Unexpected document scope') }
  const api = { fs: { readDocument: scope === 'project' ? readDocument : wrongScope, task: { readDocument: scope === 'task' ? readDocument : wrongScope } } } as unknown as FrontendOpenForgeAPI
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
      fileName: `${scope}-guide.pdf`, filePath: `${scope}-guide.pdf`, error: null, modifiedAt: 1700000000000,
      workspaceSource: scope === 'task' ? createTaskWorkspaceSource(api, 'browser-task') : createProjectWorkspaceSource(api, 'browser-project'),
      onReturnFocusToTree: () => tree.focus(),
    },
  })
  return () => { void unmount(preview); tree.remove() }
}
