import { createTerminalAuthorityCoordinator } from './terminalAuthorityCoordinator'
import { terminalLogMessage } from './terminalLogging'
import { parsePtySessionKey } from './ptySessionKey'
import { createTerminalPtyCoordinator } from './terminalPtyCoordinator'
import type {
  ShellLifecycleState,
  TerminalPtySpawnLease,
  TerminalRuntimeEnvironment,
  TerminalSession,
  TerminalSessionDiagnostics,
  TerminalViewAttachment,
} from './terminalRuntimeTypes'
import { createTerminalSessionHandle } from './terminalRuntimeTypes'
import type { TerminalTransport } from './terminalTransport'
import type { TerminalView, TerminalViewDisposable, TerminalViewTheme } from './terminalView'
import { createTerminalViewAttachmentCoordinator } from './terminalViewAttachmentCoordinator'

export interface TerminalSessionCoordinatorOptions {
  shellSessionKey: string
  view: TerminalView
  transport: TerminalTransport
  environment: TerminalRuntimeEnvironment
  notifyLifecycle(shellSessionKey: string): void
}

export interface TerminalSessionCoordinator {
  readonly session: TerminalSession
  start(): Promise<void>
  attach(host: HTMLDivElement): Promise<TerminalViewAttachment>
  beginPtySpawn(): TerminalPtySpawnLease | null
  applyPendingRestoredPtyInstance(instanceId: number): Promise<void>
  restorePtyInstance(instanceId: number): Promise<void>
  recoverFromAuthority(): Promise<void>
  recoverAfterReconnect(): Promise<void>
  getLifecycleState(): ShellLifecycleState
  isShellExited(): boolean
  resetPresentation(): Promise<void>
  focus(): void
  refresh(): void
  setTheme(theme: TerminalViewTheme): void
  diagnostics(): TerminalSessionDiagnostics
  capturePresentation(): ReturnType<TerminalView['capturePresentation']>
  drainPresentation(): ReturnType<TerminalView['drainPresentation']>
  dispose(): void
}

export function createTerminalSessionCoordinator({
  shellSessionKey,
  view,
  transport,
  environment,
  notifyLifecycle,
}: TerminalSessionCoordinatorOptions): TerminalSessionCoordinator {
  const session = createTerminalSessionHandle(shellSessionKey)
  const lifecycleListeners = new Set<(state: ShellLifecycleState) => void>()
  const viewSubscriptions: TerminalViewDisposable[] = []
  let disposed = false

  function notify(state: ShellLifecycleState): void {
    notifyLifecycle(shellSessionKey)
    for (const listener of lifecycleListeners) listener(state)
  }

  const attachment = createTerminalViewAttachmentCoordinator({
    shellSessionKey,
    view,
    environment,
  })
  const pty = createTerminalPtyCoordinator({
    shellSessionKey,
    view,
    transport,
    environment,
    notify,
  })
  const authority = createTerminalAuthorityCoordinator({
    shellSessionKey,
    view,
    transport,
    environment,
    pty,
    attachment,
    isDisposed: () => disposed,
    notify: () => notify(pty.getLifecycleState()),
  })

  function pauseModelOutput(reason: string): void {
    void authority.setModelOutputEnabled(false).catch(error => {
      console.warn(terminalLogMessage(environment.loggerName, reason), error)
    })
  }

  async function restoreVisibleAttachment(
    requestedAttachmentGeneration: number,
    requestedVisibilityGeneration: number,
  ): Promise<void> {
    await authority.setModelOutputEnabled(true)
    if (!attachment.isCurrentVisibleAttachment(
      requestedAttachmentGeneration,
      requestedVisibilityGeneration,
    )) {
      if (!attachment.isActive()) await authority.setModelOutputEnabled(false)
      return
    }

    await authority.recoverFromAuthority()
    if (attachment.isCurrentVisibleAttachment(
      requestedAttachmentGeneration,
      requestedVisibilityGeneration,
    ) && attachment.needsRecovery()) {
      await authority.recoverFromAuthority()
    }
    if (!attachment.isCurrentVisibleAttachment(
      requestedAttachmentGeneration,
      requestedVisibilityGeneration,
    )) {
      if (!attachment.isActive()) await authority.setModelOutputEnabled(false)
      return
    }
    await attachment.refitCurrent()
  }

  attachment.configureLifecycle({
    restoreVisibleAttachment,
    pauseModelOutput,
    syncPtySize: dimensions => pty.syncSize(attachment.isActive(), dimensions),
  })

  function attachAgentTerminalKeyHandler(): void {
    if (parsePtySessionKey(shellSessionKey).kind === 'indexed-shell') return

    view.setKeyEventHandler((event) => {
      const isShiftEnter = event.key === 'Enter' && event.shiftKey
      const shouldConsume = isShiftEnter && (event.type === 'keydown' || event.type === 'keypress')
      if (!shouldConsume) return true

      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'keydown' && pty.isActive()) {
        transport.writeUserInput(shellSessionKey, '\n').catch(error => {
          console.error(terminalLogMessage(environment.loggerName, 'write failed:'), error)
        })
      }
      return false
    })
  }

  async function start(): Promise<void> {
    if (disposed) throw new Error('Cannot start a disposed Terminal Session')
    await authority.start()
    if (disposed) return

    attachAgentTerminalKeyHandler()
    viewSubscriptions.push(view.onUserInput((data) => {
      if (!pty.isActive()) return
      environment.performanceTrace?.mark('inputAcceptance', {
        terminalKey: shellSessionKey,
        ptyInstanceId: pty.getCurrentInstance(),
      })
      transport.writeUserInput(shellSessionKey, data).catch(error => {
        console.error(terminalLogMessage(environment.loggerName, 'write failed:'), error)
      })
    }))
  }

  function beginPtySpawn(): TerminalPtySpawnLease | null {
    if (disposed) return null
    const request = pty.beginSpawn()
    if (!request) return null

    return Object.freeze({
      ...request,
      started: async (instanceId: number) => {
        if (disposed || !pty.startSpawn(request.generation, instanceId)) return
        authority.resetForPtyInstance(instanceId)
        await authority.recoverFromAuthority()
      },
      cancel: () => pty.cancelSpawn(request.generation),
    })
  }

  async function restorePtyInstance(instanceId: number): Promise<void> {
    const instanceChanged = pty.getCurrentInstance() !== instanceId
    const shouldRecover = pty.restoreInstance(instanceId)
    if (!shouldRecover) return
    if (instanceChanged) authority.resetForPtyInstance(instanceId)
    await authority.recoverFromAuthority()
    if (attachment.isActive()) await attachment.refitCurrent()
  }

  async function applyPendingRestoredPtyInstance(instanceId: number): Promise<void> {
    if (!pty.shouldApplyPendingRestoredInstance()) return
    await restorePtyInstance(instanceId)
  }

  async function recoverAfterReconnect(): Promise<void> {
    if (!pty.needsReconnectRecovery()) return
    await authority.recoverFromAuthority()
    notify(pty.getLifecycleState())
    attachment.refresh()
  }

  function diagnostics(): TerminalSessionDiagnostics {
    const lifecycle = pty.getLifecycleState()
    const viewDiagnostics = attachment.diagnostics()
    return Object.freeze({
      shellSessionKey,
      lifecycle: Object.freeze({
        ...lifecycle,
        attached: viewDiagnostics.attached,
        spawnPending: pty.isSpawnPending(),
        stateSource: authority.getStateSource(),
      }),
      output: Object.freeze(authority.outputDiagnostics()),
      view: Object.freeze({
        ...viewDiagnostics,
        authorityReadPending: authority.isRecoveryPending(),
      }),
      modelOutputSubscription: authority.subscriptionDiagnostics(),
      geometry: Object.freeze({ ...view.geometry }),
    })
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    attachment.detach()
    authority.dispose()
    for (const subscription of viewSubscriptions.splice(0)) subscription.dispose()
    lifecycleListeners.clear()
    view.dispose()
  }

  return {
    session,
    start,
    attach: host => {
      if (disposed) return Promise.reject(new Error('Cannot attach a disposed Terminal Session'))
      return attachment.attach(host)
    },
    beginPtySpawn,
    applyPendingRestoredPtyInstance,
    restorePtyInstance,
    recoverFromAuthority: () => authority.recoverFromAuthority(),
    recoverAfterReconnect,
    getLifecycleState: () => pty.getLifecycleState(),
    isShellExited: () => pty.isExited(),
    resetPresentation: () => view.replaceSnapshot({ data: '', ptyInstanceId: null, sequence: 0 }),
    focus: () => attachment.focus(),
    refresh: () => attachment.refresh(),
    setTheme: theme => view.setTheme(theme),
    diagnostics,
    capturePresentation: () => view.capturePresentation(),
    drainPresentation: () => view.drainPresentation(),
    dispose,
  }
}
