import { spawn } from 'node:child_process'
import { app } from 'electron'
import { developerLogSink } from './developerLogs.js'
import { resolveElectronSidecarPath } from './sidecarPath.js'
import { asChildProcessLike, createSidecarLaunchConfig, resolveSidecarPort, startSidecarReadiness } from './sidecar.js'
import type { ChildProcessLike, SidecarEventStreamAdapter, SidecarLaunchConfig, SidecarReadinessHandle } from './sidecar.js'
import { UpdateSidecarExit } from './updateSidecarExit.js'
import type { ElectronBootAdapterOptions } from './electronBootAdapter.js'
import type { ElectronBackendAdapter } from './electronBackendAdapter.js'

interface SidecarHost {
  launchOperation(): string | null
  updateLaunchAuthorized(): boolean
  admitSidecar(pid: number): Promise<string>
  createEventStream(config: SidecarLaunchConfig): SidecarEventStreamAdapter
}

/** Keeps original-source credentials and exact child ownership in the Electron host. */
export class ElectronSidecarAdapter {
  private launchProcess: ChildProcessLike | null = null
  private updateExit: UpdateSidecarExit | null = null
  private owned: SidecarReadinessHandle | null = null

  constructor(
    private readonly options: ElectronBootAdapterOptions,
    private readonly backend: ElectronBackendAdapter,
    private readonly host: SidecarHost,
  ) {}

  resolvePath(): string | null { return resolveElectronSidecarPath(this.options.env, this.options.currentDir) }
  getLaunchProcess(): ChildProcessLike | null { return this.launchProcess }

  originalSource(): { sidecarPid: number; key: string } {
    const sidecar = this.owned
    if (!sidecar?.process.pid || !this.backend.available) throw new Error('Original owned Sidecar is unavailable')
    return { sidecarPid: sidecar.process.pid, key: sidecar.config.token }
  }

  createLaunchConfig(sidecarPath: string): SidecarLaunchConfig {
    return createSidecarLaunchConfig({
      executablePath: sidecarPath, port: resolveSidecarPort(this.options.env),
      processEnv: {
        ...this.options.env,
        OPENFORGE_ELECTRON_USER_DATA_DIR: app.getPath('userData'),
        OPENFORGE_RESTART_OPERATION: this.host.launchOperation() ?? undefined,
      },
    })
  }

  async start(config: SidecarLaunchConfig): Promise<SidecarReadinessHandle> {
    developerLogSink.info(`[electron] Starting Rust sidecar: ${config.command} --host ${config.host} --port ${config.port}`)
    const sidecar = await startSidecarReadiness(config, {
      spawn: (command, args, spawnOptions) => asChildProcessLike(spawn(command, [...args], spawnOptions)),
      authorizeStartup: this.host.updateLaunchAuthorized() ? child => {
        if (!child.pid) throw new Error('Update Sidecar has no owned process identity')
        return this.host.admitSidecar(child.pid)
      } : undefined,
      fetch: (url, init) => fetch(url, init),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      onSpawned: child => {
        this.launchProcess = child
        this.updateExit = new UpdateSidecarExit(child)
      },
      logSidecarOutput: true, logger: developerLogSink, failureReporter: this.options.failureReporter,
      createEventStream: config => this.host.createEventStream(config),
    })
    const readiness = await sidecar.ready()
    this.owned = sidecar
    developerLogSink.info(`[electron] Rust sidecar is ready at ${readiness.identity.readinessUrl}`)
    this.launchProcess = sidecar.process
    return sidecar
  }

  async stopForUpdate(): Promise<void> {
    const sidecar = this.owned
    const exit = this.updateExit
    if (!sidecar || !exit) throw new Error('Owned Sidecar is unavailable for update shutdown')
    await exit.stop(sidecar)
    if (this.owned !== sidecar) throw new Error('Update Sidecar ownership changed during shutdown')
    this.backend.clear()
  }

  async retireFailedUpdateLaunch(): Promise<void> {
    if (!this.host.updateLaunchAuthorized() || !this.launchProcess) return
    const child = this.launchProcess
    const exit = this.updateExit
    if (!exit) throw new Error('Owned update Sidecar is unavailable for retirement')
    await exit.retire(child)
    if (this.launchProcess !== child) throw new Error('Update Sidecar ownership changed during retirement')
    this.backend.clear()
  }

  async waitForRecoveryExit(): Promise<void> {
    const child = this.launchProcess
    if (!child) return
    if (!this.updateExit) throw new Error('Owned Sidecar exit is unavailable')
    await this.updateExit.wait(child)
    if (this.launchProcess !== child) throw new Error('Sidecar ownership changed during recovery')
  }
}
