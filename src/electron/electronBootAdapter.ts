import { app } from 'electron'
import { configureElectronUserDataPath } from './runtimePaths.js'
import { ElectronBackendAdapter } from './electronBackendAdapter.js'
import { ElectronSidecarAdapter } from './electronSidecarAdapter.js'
import { ElectronRestartAdapter } from './electronRestartAdapter.js'
import { ElectronRendererAdapter } from './electronRendererAdapter.js'
import { ElectronTaskBrowserAdapter } from './electronTaskBrowserAdapter.js'
import type { BootLifecycleAdapter } from './bootLifecycle.js'
import type { ElectronFailureReporter } from './failureReporting.js'

// Retain the existing event-forwarding export for callers of the boot adapter.
export { forwardTaskBrowserSurfaceRendererEvent } from './electronTaskBrowserAdapter.js'

export interface ElectronBootAdapterOptions {
  currentDir: string
  workspaceRoot: string
  env: NodeJS.ProcessEnv
  failureReporter?: ElectronFailureReporter | null
}

/** Composes host-owned lifecycles behind the unchanged BootLifecycleAdapter seam. */
export function createElectronBootAdapter(options: ElectronBootAdapterOptions): BootLifecycleAdapter {
  const backend = new ElectronBackendAdapter()
  const browser = new ElectronTaskBrowserAdapter(backend)
  // These callbacks run after composition, never during construction.
  const sidecar = new ElectronSidecarAdapter(options, backend, {
    launchOperation: () => restart.launchOperation,
    updateLaunchAuthorized: () => restart.updateLaunchAuthorized,
    admitSidecar: pid => restart.admitSidecar(pid),
    createEventStream: config => renderer.createEventStream(config),
  })
  const restart = new ElectronRestartAdapter(options, backend, sidecar, id => renderer.hasRenderer(id))
  const renderer = new ElectronRendererAdapter(options, backend, restart, browser)

  return {
    registerPluginProtocolSchemeAsPrivileged: () => renderer.registerPluginProtocolSchemeAsPrivileged(),
    registerBackendInvokeHandler: context => backend.register(context, { renderer, restart, browser }),
    configureUserDataPath: () => configureElectronUserDataPath(app, options.env),
    onWindowAllClosed: handler => { app.on('window-all-closed', handler) },
    onBeforeQuit: handler => restart.onBeforeQuit(event => {
      renderer.shutdown()
      browser.shutdown()
      handler(event)
    }),
    exit: exitCode => app.exit(exitCode),
    waitForAppReady: () => restart.waitForAppReady(),
    preflightUpdateLaunch: () => restart.preflightUpdateLaunch(),
    resolveSidecarPath: () => sidecar.resolvePath(),
    createSidecarLaunchConfig: path => sidecar.createLaunchConfig(path),
    startSidecar: config => sidecar.start(config),
    getSidecarLaunchProcess: () => sidecar.getLaunchProcess(),
    registerPluginProtocolHandler: config => renderer.registerPluginProtocol(config),
    applyRendererCsp: config => renderer.applyRendererCsp(config),
    createMainWindow: () => renderer.createMainWindow(),
    retireFailedUpdateLaunch: () => sidecar.retireFailedUpdateLaunch(),
    recoverRestart: failure => restart.recoverBoot(failure),
    quit: () => app.quit(),
  }
}
