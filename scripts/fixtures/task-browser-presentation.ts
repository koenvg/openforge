import { mount } from 'svelte'
import TaskBrowserTab from '../../plugins/task-browser/src/TaskBrowserTab.svelte'
import { createMockFrontendOpenForgeApi, createMockPluginContext } from '@openforge-app/plugin-sdk/testing'
import type { TaskBrowserSurfaceController, TaskBrowserSurfaceState } from '@openforge-app/plugin-sdk/frontend'
import { createThemeRegistry } from '../../src/lib/themeRegistry'
import { createThemeDocumentAdapter } from '../../src/lib/themeDocumentAdapter'

export const themeRegistry = createThemeRegistry({ applyTheme: createThemeDocumentAdapter(document.documentElement).apply })
await themeRegistry.selectTheme('openforge-light')

// Simulate only the host browser/storage boundary; mount the real plugin and editor.
export const lifecycle = { created: 0, attached: 0, detached: 0, destroyed: 0 }
export let failSave = false
export let finishSend: (() => void) | undefined
export function blockSend() {
  sendBarrier = new Promise<void>(resolve => { finishSend = resolve })
}
export function rejectSaves(value: boolean) { failSave = value }
let sendBarrier: Promise<void> | undefined
const state: TaskBrowserSurfaceState = {
  url: 'https://example.com/checkout', title: 'Checkout preview', loading: false,
  canGoBack: false, canGoForward: false, devToolsOpen: false, error: null,
}
const surface: TaskBrowserSurfaceController = {
  async attach() { lifecycle.attached++; return { dispose() { lifecycle.detached++ } } },
  async detach() { lifecycle.detached++ },
  async destroy() { lifecycle.destroyed++ },
  async getState() { return state },
  onStateChanged() { return { dispose() {} } },
  onVisualFeedbackAction() { return { dispose() {} } },
  async navigate(url) { return { ...state, url } },
  async goBack() { return state }, async goForward() { return state },
  async reload() { throw new Error('Preview connection unavailable. Try again without losing your feedback.') },
  async stop() { return state },
  async openDevTools() { return { ...state, devToolsOpen: true } },
  async closeDevTools() { return state },
  async selectVisibleRegion() { return null },
  async cancelVisibleRegionSelection() {}, async clearVisualFeedback() {},
  async replaceVisualFeedback() {}, async captureExists() { return false },
  async captureVisibleViewport() { throw new Error('No capture requested by this fixture') },
  async discardCapture() {},
}
const draft = {
  version: 1,
  captures: [{ number: 1, evidence: {
    artifactId: 'missing', absolutePath: '/tmp/openforge/missing.png', mediaType: 'image/png',
    width: 640, height: 480, url: state.url, title: state.title, capturedAt: '2026-08-11T14:30:00.000Z',
  } }],
  annotations: [{ number: 1, captureNumber: 1, rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, comment: 'Align the checkout button with the order summary.' }],
}
for (const kind of ['loading', 'live', 'unavailable']) {
  const target = document.createElement('section')
  target.id = kind
  target.style.height = kind === 'live' ? '440px' : '150px'
  target.setAttribute('aria-label', `${kind} browser fixture`)
  document.getElementById('app')!.append(target)
  const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' })
  api.browserSurfaces.getOrCreate = async () => {
    if (kind === 'loading') return new Promise(() => {})
    if (kind === 'unavailable') throw new Error('Host is unavailable')
    lifecycle.created++
    return surface
  }
  if (kind === 'live') {
    await api.storage.task(kind).set('visualFeedbackDraftV1', draft)
    const storage = api.storage.task(kind)
    const save = storage.set.bind(storage)
    storage.set = async (key, value) => {
      if (key === 'visualFeedbackDraftV1') {
        if (failSave) throw new Error('disk full')
      }
      await save(key, value)
    }
    api.storage.task = () => storage
    api.tasks.sendFollowUp = async () => {
      await sendBarrier
      throw new Error('Agent unavailable; feedback retained')
    }
  }
  let component = TaskBrowserTab
  if (new URLSearchParams(location.search).has('production')) {
    const { default: plugin } = await import('../../plugins/task-browser/dist/frontend.js')
    api.taskUI.registerTab = tab => { component = tab.component as typeof TaskBrowserTab; return { dispose() {} } }
    await plugin.activate(api, createMockPluginContext({ pluginId: 'com.openforge.task-browser', projectId: 'P-1' }))
  }
  mount(component, { target, props: { api, context: api.context.getSnapshot(), taskId: kind, projectId: 'P-1' } })
}
