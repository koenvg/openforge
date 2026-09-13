import { mount } from 'svelte'
import { derived } from 'svelte/store'
import Fixture from './TerminalPresentationMigration.svelte'
import { createThemeRegistry } from '../../src/lib/themeRegistry'
import { createThemeDocumentAdapter } from '../../src/lib/themeDocumentAdapter'
import { createTerminalThemeSnapshot } from '../../src/lib/terminalThemePresentation'
import { createTerminalRuntime, type TerminalTransport } from '../../packages/terminal-runtime/src/terminalRuntime'
import { createTerminalSessionService } from '../../packages/terminal-runtime/src/terminalSessionService'
import { configureTerminalSessionClient } from '../../plugins/terminal/src/lib/terminalPool'
import type { TerminalSurfaceAdapter } from '../../packages/terminal-runtime/src/terminalSurfaceAdapter'

const documentAdapter = createThemeDocumentAdapter(document.documentElement)
export const themeRegistry = createThemeRegistry({ applyTheme: documentAdapter.apply })
await themeRegistry.selectTheme('openforge-light')

// Only the external workspace/PTY boundary is simulated. Surfaces, theme selection,
// runtime, attachment, and xterm rendering are the production implementations.
const transport: TerminalTransport = {
  async subscribeSession() { return { dispose() {}, async setModelOutputEnabled() {} } },
  async subscribeConnectionRestored() { return { dispose() {} } },
  async readReplay() {
    return {
      historicalData: null, isLive: true, ptyInstanceId: 41,
      snapshot: {
        data: new TextEncoder().encode('Terminal contents survive theme changes\r\n$ '),
        ptyInstanceId: 41, watermark: 0, continuationData: new Uint8Array(),
      },
    }
  },
  async writeUserInput() {},
  async resize() {},
  dispose() {},
}
export const runtime = createTerminalRuntime({
  transport,
  environment: { openLink: async () => {}, themePresentation: derived(themeRegistry.selectedTheme, createTerminalThemeSnapshot) },
})
const sessions = createTerminalSessionService(runtime)
configureTerminalSessionClient(sessions.createClient('plugin:com.openforge.terminal'))
const adapter: TerminalSurfaceAdapter = {
  runtime: sessions.createClient('host:terminal-presentation-fixture'),
  async spawnShellPty() { throw new Error('Theme changes must not spawn a shell') },
  async killPty() { throw new Error('Theme changes must not kill a shell') },
  getTaskWorkspace: () => new Promise(() => {}),
  getWorkspacePath: workspace => workspace?.workspace_path ?? null,
  registerTaskPaneController() {},
  unregisterTaskPaneController() {},
}
mount(Fixture, { target: document.getElementById('app')!, props: { adapter } })
