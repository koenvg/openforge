import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { app, dialog } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { NativeRestartRecovery } from './nativeRestartRecovery.js'
import { RestartOperation } from './restartOperation.js'
import type { RecoveryFailure } from './restartOperation.js'
import { preflightProductionUpdateLaunch } from './productionUpdateLaunch.js'
import { LocalUpdateDriver } from './localUpdateDriver.js'
import { RestartWorkspaceIpc } from './restartWorkspaceIpc.js'
import { createControlledRestartHost } from './controlledRestartHost.js'
import { installRestartMenu, installRestartRecoveryMenu } from './restartMenu.js'
import { RestartGeometryLeases } from './restartGeometryLeases.js'
import type { RestartAttachmentIdentity } from './restartGeometryLeases.js'
import type { RestartTerminalFence, RestartTerminalInventory } from './restartWorkspace.js'
import { developerLogSink } from './developerLogs.js'
import type { ElectronBootAdapterOptions } from './electronBootAdapter.js'
import type { ElectronBackendAdapter } from './electronBackendAdapter.js'
import type { ElectronSidecarAdapter } from './electronSidecarAdapter.js'

const operationPrefix = '--openforge-restart-operation='

/** Owns native replacement/recovery authority and the ordinary Quit approval gate. No update entry point is installed. */
export class ElectronRestartAdapter {
  private workspace: Promise<RestartWorkspaceIpc> | null = null
  private localUpdate: LocalUpdateDriver | null = null
  private recovery: NativeRestartRecovery | null = null
  private operation = process.argv.find(arg => arg.startsWith(operationPrefix))?.slice(operationPrefix.length) ?? null
  private updateAuthorized = false
  private authorizedRelaunch = false
  private quitApproved = false
  private checkingQuit = false
  private readonly geometry = new RestartGeometryLeases()

  constructor(
    private readonly options: ElectronBootAdapterOptions,
    private readonly backend: ElectronBackendAdapter,
    private readonly sidecar: ElectronSidecarAdapter,
    private readonly hasRenderer: (rendererId: number) => boolean,
  ) {}

  get launchOperation(): string | null { return this.operation }
  get updateLaunchAuthorized(): boolean { return this.updateAuthorized }
  admitSidecar(pid: number): Promise<string> { return this.updates().admitSidecar(pid) }
  focus(rendererId: number): void { this.geometry.focus(rendererId) }
  forget(rendererId: number): void { this.geometry.forget(rendererId) }

  private async terminalInventory(): Promise<RestartTerminalInventory> {
    return await this.backend.invoke({ command: 'get_restart_terminal_inventory', payload: {} }, 'Restart backend is not ready') as RestartTerminalInventory
  }

  private updates(): LocalUpdateDriver {
    this.localUpdate ??= new LocalUpdateDriver({
      root: app.getPath('userData'), installedBundlePath: resolve(dirname(process.execPath), '..', '..'),
      inventory: () => this.terminalInventory(), source: () => this.sidecar.originalSource(),
      chooseBundle: async () => {
        const result = await dialog.showOpenDialog({
          title: 'Install a local OpenForge build', buttonLabel: 'Select build',
          properties: ['openFile'], filters: [{ name: 'OpenForge application', extensions: ['app'] }],
        })
        return result.canceled ? null : result.filePaths[0] ?? null
      },
      quit: () => { this.authorizedRelaunch = true; app.quit() },
    })
    return this.localUpdate
  }

  private relaunch(operationId: string | null): void {
    if (this.checkingQuit) throw new Error('Quit is already checking session ownership')
    app.relaunch({ args: [...process.argv.slice(1).filter(arg => !arg.startsWith(operationPrefix)), ...(operationId ? [`${operationPrefix}${operationId}`] : [])] })
    this.authorizedRelaunch = true
    app.quit()
  }

  private nativeRecovery(): NativeRestartRecovery {
    this.recovery ??= new NativeRestartRecovery({
      root: app.getPath('userData'), env: this.options.env, currentDir: this.options.currentDir,
      relaunch: operationId => { this.checkingQuit = false; this.relaunch(operationId) },
      quit: () => { this.quitApproved = true; app.quit() },
      update: {
        retry: async target => {
          await this.sidecar.retireFailedUpdateLaunch()
          await this.updates().recover(target)
        },
        close: async () => {
          await this.sidecar.retireFailedUpdateLaunch()
          await this.sidecar.waitForRecoveryExit()
          // No ordinary Quit cleanup: sessions remain owned by the surviving daemon.
          app.exit(0)
        },
      },
    })
    return this.recovery
  }

  recoverBoot(failure: RecoveryFailure): Promise<boolean> { return this.nativeRecovery().recoverBoot(failure) }

  controlledWorkspace(): Promise<RestartWorkspaceIpc | null> {
    // Older isolated fixtures deliberately exercise the legacy test adapter.
    if (this.options.env.OPENFORGE_E2E === '1' && !this.options.env.OPENFORGE_SESSION_DAEMON_ROOT) return Promise.resolve(null)
    if (this.workspace) return this.workspace
    this.workspace = createControlledRestartHost({
      root: app.getPath('userData'), operationId: this.operation,
      inventory: () => this.terminalInventory(), update: this.updates(),
      backend: {
        prepare: (operationId, intent) => this.backend.forward('prepare_app_restart', { operationId, intent }),
        cancel: operationId => this.backend.forward('cancel_app_restart', { operationId }),
        detach: operationId => this.backend.forward('detach_app_restart', { operationId }),
        commit: operationId => this.backend.forward('commit_app_restart', { operationId }),
        stopForUpdate: () => this.sidecar.stopForUpdate(),
      },
      replace: async nextOperation => this.relaunch(nextOperation),
    }).catch(error => { this.workspace = null; throw error })
    return this.workspace
  }

  async handleWorkspace(event: IpcMainInvokeEvent, command: string, payload: unknown): Promise<unknown> {
    if (!this.hasRenderer(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted restart workspace renderer')
    const host = await this.controlledWorkspace()
    if (!host && command === 'get_restart_workspace') return null
    if (!host) throw new Error('Controlled restart is disabled')
    return host.handle(event.sender.id, command, payload)
  }

  async resize(event: IpcMainInvokeEvent, input: object, invoke: (payload: Record<string, unknown>) => Promise<unknown>): Promise<unknown> {
    if (!await this.controlledWorkspace() || !this.hasRenderer(event.sender.id) || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Untrusted terminal geometry request')
    }
    const { attachment, ...payload } = input as Record<string, unknown>
    const fence = payload.fence as RestartTerminalFence | undefined
    if (!attachment || typeof attachment !== 'object' || typeof payload.shellSessionKey !== 'string'
      || !fence?.controller || typeof fence.controller.installation !== 'string' || typeof fence.controller.lifetime !== 'string'
      || !Number.isSafeInteger(fence.controller.generation) || !Number.isSafeInteger(fence.instanceId)) {
      throw new Error('Invalid terminal geometry identity')
    }
    return this.geometry.resize(event.sender.id, payload.shellSessionKey, fence, attachment as RestartAttachmentIdentity, async () => {
      if (!this.hasRenderer(event.sender.id)) throw new Error('Terminal renderer closed before resize')
      await invoke(payload)
    })
  }

  onBeforeQuit(handler: (event: { preventDefault(): void }) => void): void {
    app.on('before-quit', event => {
      if (!this.authorizedRelaunch && !this.quitApproved) {
        event.preventDefault()
        if (this.checkingQuit) return
        this.checkingQuit = true
        void this.nativeRecovery().quit().then(handled => {
          if (!handled) { this.quitApproved = true; app.quit() }
        }).catch(error => {
          dialog.showErrorBox('Quit not completed', String(error))
        }).finally(() => { this.checkingQuit = false })
        return
      }
      handler(event)
    })
  }

  async waitForAppReady(): Promise<void> {
    await app.whenReady()
    const pending = await (await RestartOperation.open(app.getPath('userData')))?.status()
    if (pending && pending.intent !== 'update' && ['detached', 'reconnecting'].includes(pending.phase)) this.operation ??= pending.operationId
    installRestartRecoveryMenu(async () => {
      const status = await (await RestartOperation.open(app.getPath('userData')))?.status()
      await this.nativeRecovery().recover(status?.failure ?? 'relaunch-delayed')
    })
  }

  async preflightUpdateLaunch(): Promise<void> {
    this.updateAuthorized = Boolean(await preflightProductionUpdateLaunch(app.getPath('userData'), {
      operationId: this.operation, authorize: target => this.updates().authorizeLaunch(target),
    }))
    if (!this.updateAuthorized && app.isPackaged && process.platform === 'darwin') {
      const bundle = resolve(dirname(process.execPath), '..', '..')
      await promisify(execFile)(join(bundle, 'Contents/MacOS/openforge-update-helper'), ['--cold-startup', bundle, app.getPath('userData')], { timeout: 30_000, env: this.options.env })
    }
  }

  installWorkspaceMenu(): void {
    installRestartMenu(async rendererId => {
      if (!this.hasRenderer(rendererId)) throw new Error('Restart requires an OpenForge workspace')
      const host = await this.controlledWorkspace()
      if (!host) throw new Error('Session-preserving Restart is unavailable in this launch')
      try {
        await host.handle(rendererId, 'restart_app', {})
      } catch (error) {
        if (!await this.nativeRecovery().recover('relaunch-delayed')) throw error
      }
    })
    const restorationTimer = setTimeout(() => {
      void RestartOperation.open(app.getPath('userData')).then(async operation => {
        const record = await operation?.status()
        if (record?.phase === 'reconnecting') await this.nativeRecovery().recover('interface-restoration-incomplete')
      }).catch(error => developerLogSink.error('[restart] Recovery unavailable', error))
    }, 30_000)
    restorationTimer.unref()
  }
}
