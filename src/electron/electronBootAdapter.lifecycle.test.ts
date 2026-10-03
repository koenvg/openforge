// @vitest-environment node
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { electronFakes } from './taskBrowserSurfaceElectronAdapter.testUtils'
import { RestartOperation, restartInstallationId } from './restartOperation'
import type { SidecarReadinessHandle } from './sidecar'

class OwnedChild extends EventEmitter {
  readonly pid = 4321
  killed = false
  readonly signals: string[] = []
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  kill(signal = 'SIGTERM') {
    this.killed = true
    this.signals.push(signal)
    queueMicrotask(() => this.emit('exit', 0, signal))
    return true
  }
}
const spawn = vi.fn(() => new OwnedChild())
vi.doMock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn,
}))
const runningSidecars: SidecarReadinessHandle[] = []

class HostWindow extends electronFakes.FakeBrowserWindow {
  static getAllWindows() { return windows.filter(window => !window.isDestroyed()) }
  static getFocusedWindow() { return this.getAllWindows().at(-1) ?? null }
  static fromId(id: number) { return windows.find(window => window.id === id) ?? null }
  static fromWebContents(contents: unknown) { return windows.find(window => window.webContents === contents) ?? null }
  readonly id = windows.length + 1
  readonly renderer = Object.assign(this.webContents, { id: this.id + 100, mainFrame: {} })
  constructor(options: ConstructorParameters<typeof electronFakes.FakeBrowserWindow>[0]) {
    super(options)
    windows.push(this)
  }
  getContentBounds() { return { width: 1000, height: 800 } }
  isFocused() { return HostWindow.getFocusedWindow() === this }
  once(event: string, listener: (...args: unknown[]) => void) { this.on(event, listener); return this }
  async loadURL(url: string) { await this.webContents.loadURL(url) }
  async loadFile(path: string) { await this.loadURL(`file://${path}`) }
  show() {}
  focus() { this.emit('focus') }
  setProgressBar() {}
}
const windows: HostWindow[] = []
const appEvents = new EventEmitter()
const handlers = new Map<string, (event: unknown, request: unknown) => unknown>()
let root = ''
const quit = vi.fn()
const exit = vi.fn()
const relaunch = vi.fn()
const showMessageBox = vi.fn(async () => ({ response: 2, checkboxChecked: false }))
let menuItems: Array<{ id?: string; role?: string; click?: () => Promise<void> }> = []
vi.doMock('electron', () => ({
  BrowserWindow: HostWindow,
  WebContentsView: electronFakes.FakeWebContentsView,
  app: {
    isPackaged: false, getPath: () => root,
    whenReady: async () => {}, on: appEvents.on.bind(appEvents), quit, exit, relaunch,
  },
  ipcMain: { handle: (channel: string, handler: (event: unknown, request: unknown) => unknown) => handlers.set(channel, handler) },
  dialog: { showMessageBox, showErrorBox: vi.fn() },
  clipboard: { writeText: vi.fn() }, shell: { openExternal: vi.fn() },
  session: { fromPartition: electronFakes.sessionFor }, protocol: {},
  MenuItem: class { constructor(options: object) { Object.assign(this, options) } },
  Menu: {
    getApplicationMenu: () => null,
    buildFromTemplate: () => {
      const submenu = { items: menuItems, insert: (index: number, item: typeof menuItems[number]) => menuItems.splice(index, 0, item) }
      return { items: [{ submenu }] }
    },
    setApplicationMenu: () => {},
  },
}))
const { createElectronBootAdapter } = await import('./electronBootAdapter')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openforge-boot-host-'))
  windows.length = 0
  menuItems = [{ role: 'quit' }]
  handlers.clear()
  appEvents.removeAllListeners()
  electronFakes.reset()
  vi.clearAllMocks()
  showMessageBox.mockResolvedValue({ response: 2, checkboxChecked: false })
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(runningSidecars.splice(0).map(sidecar => sidecar.stop()))
  await rm(root, { recursive: true, force: true })
})
function adapter(controlled = false) {
  return createElectronBootAdapter({ currentDir: root, workspaceRoot: root, env: {
    OPENFORGE_E2E: '1', ...(controlled ? { OPENFORGE_SESSION_DAEMON_ROOT: root } : {}),
  } })
}
async function pending(intent: 'restart' | 'update', detached = false) {
  const controller = { installation: 'installation', lifetime: 'daemon', generation: 1 }
  const operation = new RestartOperation(join(root, 'restart-operation.json'), restartInstallationId(root, controller.installation))
  await operation.prepare('owned-operation', controller, intent)
  if (detached) await operation.detach('owned-operation')
  return operation
}
function invoke(window: HostWindow, command: string, payload: unknown = {}, senderFrame: unknown = window.renderer.mainFrame) {
  return handlers.get('openforge:invoke')!({ sender: window.renderer, senderFrame }, { command, payload })
}
function subscribe(window: HostWindow) {
  return handlers.get('openforge:event-subscription')!({ sender: window.renderer }, { action: 'subscribe', eventName: 'task-changed' })
}

async function liveHost(controlled = false) {
  const host = adapter(controlled)
  const config = host.createSidecarLaunchConfig('/owned-sidecar')
  let sidecar: SidecarReadinessHandle | null = null
  host.registerBackendInvokeHandler({ getSidecarConfig: () => sidecar?.config ?? null })
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const commands: Array<{ command: string; payload: unknown }> = []
  const fetchHost = vi.fn(async (url: string, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${config.token}`)
    if (url === config.readinessUrl) return Response.json({ status: 'ok', startupResume: { phase: 'complete' } })
    if (url === config.eventUrl) return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller
        init?.signal?.addEventListener('abort', () => controller.close(), { once: true })
      },
    }))
    const request = JSON.parse(init?.body as string) as typeof commands[number]
    commands.push(request)
    const value = request.command === 'get_task_detail' ? { project_id: 'P-1', status: 'doing' }
      : request.command === 'get_enabled_plugins' ? [{ id: 'browser' }]
      : request.command === 'list_browser_session_purge_intents' ? []
      : request.command === 'get_restart_terminal_inventory' ? {
          controller: { installation: 'installation', lifetime: 'daemon', generation: 2 },
          sessions: [{ key: 'T-1-shell-0', instanceId: 7, isLive: true }], hasLegacySessions: false, daemonRoot: root,
        }
      : true
    return Response.json({ value })
  })
  vi.stubGlobal('fetch', fetchHost)
  sidecar = await host.startSidecar(config)
  runningSidecars.push(sidecar)
  return {
    host, config, sidecar, commands,
    emit: (eventName: string, payload: unknown) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ eventName, payload })}\n\n`)),
  }
}
describe('Electron BootLifecycleAdapter host policies', () => {
  it('routes fenced terminal resize only from registered main frames and drops stale attachment work', async () => {
    const { host, commands } = await liveHost(true)
    const window = await host.createMainWindow() as HostWindow
    await expect(invoke(window, 'get_restart_workspace')).resolves.toBeNull()
    const fence = { controller: { installation: 'installation', lifetime: 'daemon', generation: 2 }, instanceId: 7 }
    const payload = { shellSessionKey: 'T-1-shell-0', fence, cols: 100, rows: 30 }
    const request = { ...payload, attachment: { sessionId: 'terminal-view', sessionGeneration: 1, attachmentGeneration: 2 } }
    await expect(invoke(window, 'pty_resize', request, {})).rejects.toThrow('Untrusted terminal geometry request')
    await invoke(window, 'pty_resize', request)
    await invoke(window, 'pty_resize', { ...request, attachment: { ...request.attachment, attachmentGeneration: 1 } })
    expect(commands.filter(command => command.command === 'pty_resize')).toEqual([{ command: 'pty_resize', payload }])
    window.destroy()
    await expect(invoke(window, 'pty_resize', request)).rejects.toThrow('Untrusted terminal geometry request')
  })

  it('cancels controlled restart capture when a registered workspace window closes', async () => {
    const { host, commands } = await liveHost(true)
    const window = await host.createMainWindow() as HostWindow
    const restarting = Promise.resolve(invoke(window, 'restart_app')).catch(error => error as Error)
    await vi.waitFor(() => expect(window.renderer.sentMessages).toContainEqual([
      'openforge:event', { eventName: 'restart-workspace-capture', payload: { operationId: expect.any(String) } },
    ]))
    window.destroy()
    expect(await restarting).toMatchObject({ message: 'Window closed during workspace capture' })
    expect((await (await RestartOperation.open(root))!.status())?.phase).toBe('cancelled')
    expect(commands.filter(command => command.command === 'cancel_app_restart')).toHaveLength(1)
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('tracks the exact owned Sidecar and keeps backend credentials out of renderer events', async () => {
    const { host, config, sidecar, emit } = await liveHost()
    expect(host.getSidecarLaunchProcess()).toBe(sidecar.process)
    expect(spawn).toHaveBeenCalledWith('/owned-sidecar', config.args, expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }))
    const window = await host.createMainWindow() as HostWindow
    subscribe(window)
    emit('task-changed', { task_id: 'T-1', action: 'updated' })
    await vi.waitFor(() => expect(window.renderer.sentMessages).toContainEqual(['openforge:event', {
      eventName: 'task-changed', payload: { task_id: 'T-1', action: 'updated' },
    }]))
    expect(JSON.stringify(window.renderer.sentMessages)).not.toContain(config.token)
    await host.retireFailedUpdateLaunch!()
    expect((sidecar.process as OwnedChild).signals).toEqual([])
    await sidecar.stop()
    expect((sidecar.process as OwnedChild).signals).toEqual(['SIGTERM'])
  })

  it('keeps Task Browser captures and permissions with their live window owner', async () => {
    const { host } = await liveHost()
    const first = await host.createMainWindow() as HostWindow
    const second = await host.createMainWindow() as HostWindow
    const reference = await invoke(first, 'task_browser_surface_get_or_create', {
      pluginId: 'browser', taskId: 'T-1', id: 'main', initialUrl: 'https://example.com',
    }) as { ok: boolean; value: { surfaceId: string; generation: number } }
    expect(reference.ok).toBe(true)
    const owner = { pluginId: 'browser', taskId: 'T-1', ...reference.value }
    await invoke(first, 'task_browser_surface_attach', {
      surfaceId: owner.surfaceId, attachmentId: 'attachment-1', attachmentGeneration: 1,
      bounds: { x: 0, y: 0, width: 640, height: 480 },
    })
    const capture = await invoke(first, 'task_browser_surface_capture_visible_viewport', owner) as { ok: boolean; value: { artifactId: string } }
    expect(capture).toMatchObject({ ok: true, value: { width: 640, height: 480, mediaType: 'image/png' } })
    await expect(invoke(first, 'task_browser_surface_capture_exists', { ...owner, artifactId: capture.value.artifactId })).resolves.toEqual({ ok: true, value: true })
    await expect(invoke(second, 'task_browser_surface_capture_visible_viewport', owner)).resolves.toMatchObject({ ok: false, error: { code: 'SURFACE_ACCESS_DENIED' } })
    const contents = electronFakes.views[0].webContents
    const requestPermission = contents.session.handlers.get('permission-request')![0]
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    const decision = vi.fn()
    requestPermission(contents, 'notifications', decision, { requestingUrl: 'https://example.com', isMainFrame: true })
    await vi.waitFor(() => expect(decision).toHaveBeenCalledWith(true))
    first.destroy()
    expect(contents.isDestroyed()).toBe(true)
    const denied = vi.fn()
    requestPermission(contents, 'notifications', denied, { requestingUrl: 'https://example.com', isMainFrame: true })
    expect(denied).toHaveBeenCalledWith(false)
    await expect(invoke(second, 'task_browser_surface_capture_visible_viewport', owner)).resolves.toMatchObject({ ok: false })
  })

  it('releases Task Browser surfaces on backend deletion and drains pending partition purges', async () => {
    const { host, emit, commands } = await liveHost()
    const window = await host.createMainWindow() as HostWindow
    const result = await invoke(window, 'task_browser_surface_get_or_create', { pluginId: 'browser', taskId: 'T-1', id: 'main' })
    expect(result).toMatchObject({ ok: true })
    commands.length = 0
    emit('task-changed', { action: 'deleted', task_id: 'T-1' })
    await vi.waitFor(() => expect(electronFakes.views[0].webContents.isDestroyed()).toBe(true))
    await vi.waitFor(() => expect(commands).toContainEqual({ command: 'list_browser_session_purge_intents', payload: null }))
  })

  it('routes host requests only to the selected renderer and fails them when that renderer is lost', async () => {
    const { host, emit, commands } = await liveHost()
    const first = await host.createMainWindow() as HostWindow
    const second = await host.createMainWindow() as HostWindow
    emit('plugin-frontend-command-request', {
      operation: 'invoke', correlationId: 'request-1', pluginId: 'browser',
      projectId: 'P-1', commandId: 'browser.open', input: {},
      context: { taskId: 'T-1', projectId: 'P-1', source: 'agent-cli' },
    })
    await vi.waitFor(() => expect(second.renderer.sentMessages).toHaveLength(1))
    expect(first.renderer.sentMessages).toEqual([])
    const acknowledgement = { correlationId: 'request-1', outcome: { status: 'success', output: {} } }
    await expect(invoke(first, 'plugin_frontend_command_acknowledge', acknowledgement)).rejects.toThrow('does not own')
    second.renderer.emit('render-process-gone')
    await vi.waitFor(() => expect(commands).toContainEqual({
      command: 'plugin_frontend_command_acknowledge',
      payload: { correlationId: 'request-1', outcome: { status: 'error', error: 'OpenForge trusted renderer was lost before the request completed' } },
    }))
    await expect(invoke(second, 'plugin_frontend_command_acknowledge', acknowledgement)).resolves.toBe(false)
  })

  it('keeps renderer registration scoped to each live window and rejects foreign restart frames', async () => {
    const host = adapter()
    host.registerBackendInvokeHandler({ getSidecarConfig: () => null })
    const first = await host.createMainWindow() as HostWindow
    const second = await host.createMainWindow() as HostWindow
    expect(subscribe(first)).toBe(true)
    expect(subscribe(second)).toBe(true)
    await expect(invoke(first, 'get_restart_workspace', {}, {})).rejects.toThrow('Untrusted restart workspace renderer')
    await expect(invoke(first, 'get_restart_workspace')).resolves.toBeNull()
    first.destroy()
    expect(subscribe(first)).toBe(false)
    expect(subscribe(second)).toBe(true)
    await expect(invoke(first, 'get_restart_workspace')).rejects.toThrow('Untrusted restart workspace renderer')
  })

  it('checks ordinary Quit before allowing boot shutdown and prevents duplicate checks', async () => {
    const host = adapter()
    const shutdown = vi.fn()
    host.onBeforeQuit(shutdown)
    const event = { preventDefault: vi.fn() }
    appEvents.emit('before-quit', event)
    appEvents.emit('before-quit', event)
    expect(shutdown).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
    appEvents.emit('before-quit', event)
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(2)
  })

  it('preserves restart identity on replacement without running ordinary Quit recovery', async () => {
    const operation = await pending('restart', true)
    const host = adapter()
    const shutdown = vi.fn()
    host.onBeforeQuit(shutdown)
    await host.waitForAppReady()
    expect(host.createSidecarLaunchConfig('/sidecar').env.OPENFORGE_RESTART_OPERATION).toBe('owned-operation')
    showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    await expect(host.recoverRestart!('relaunch-delayed')).resolves.toBe(true)
    expect(relaunch).toHaveBeenCalledWith({ args: expect.arrayContaining(['--openforge-restart-operation=owned-operation']) })
    const event = { preventDefault: vi.fn() }
    appEvents.emit('before-quit', event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(await operation.shutdownIntent()).toBe('restart')
  })

  it('refuses unsupported update startup and exposes no renderer or native-menu update entry point', async () => {
    const operation = await pending('update', true)
    const host = adapter()
    host.registerBackendInvokeHandler({ getSidecarConfig: () => null })
    await host.waitForAppReady()
    await expect(host.preflightUpdateLaunch!()).rejects.toThrow('trusted-release verification')
    const window = await host.createMainWindow() as HostWindow
    await expect(invoke(window, 'update_app')).rejects.toThrow('not implemented')
    expect(menuItems.map(item => item.id).filter(Boolean)).toEqual(['openforge-restart-recovery', 'openforge-restart'])
    expect(await operation.shutdownIntent()).toBe('update')
  })

  it('closes update recovery without ordinary Quit cleanup or session termination', async () => {
    const operation = await pending('update', true)
    const host = adapter()
    const shutdown = vi.fn()
    host.onBeforeQuit(shutdown)
    showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false })
    await expect(host.recoverRestart!('update-verification-unavailable')).resolves.toBe(true)
    expect(exit).toHaveBeenCalledWith(0)
    expect(quit).not.toHaveBeenCalled()
    expect(relaunch).not.toHaveBeenCalled()
    expect(shutdown).not.toHaveBeenCalled()
    expect(await operation.shutdownIntent()).toBe('update')
  })
})
