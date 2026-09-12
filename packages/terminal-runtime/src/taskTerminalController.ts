import type {
  ShellLifecycleState,
  TerminalSession,
  TerminalViewAttachment,
} from './terminalRuntime'
import type { TerminalSurfaceAdapter } from './terminalSurfaceAdapter'

export interface TaskTerminalBinding {
  taskId: string
  workspacePath: string
  terminalKey: string
  terminalIndex: number
  isActive: boolean
}

export interface TaskTerminalControllerSnapshot {
  boundTerminalKey: string | null
  lifecycle: ShellLifecycleState
}

export interface TaskTerminalController {
  mount(binding: TaskTerminalBinding): void
  sync(binding: TaskTerminalBinding): void
  restart(): Promise<void>
  destroy(): void
  getSnapshot(): TaskTerminalControllerSnapshot
}

export interface TaskTerminalRestartState {
  pending: boolean
  error: string | null
}

export interface TaskTerminalControllerOptions {
  adapter: TerminalSurfaceAdapter
  terminalHost: HTMLDivElement
  onLifecycleChange(state: ShellLifecycleState): void
  onRestartStateChange?(state: TaskTerminalRestartState): void
}

const initialLifecycle: ShellLifecycleState = {
  ptyActive: false,
  shellExited: false,
  currentPtyInstance: null,
  hasOutput: false,
}

function bindingContextSignature(binding: TaskTerminalBinding): string {
  return `${binding.taskId}\u0000${binding.workspacePath}\u0000${binding.terminalKey}\u0000${binding.terminalIndex}`
}

export function createTaskTerminalController({
  adapter,
  terminalHost,
  onLifecycleChange,
  onRestartStateChange,
}: TaskTerminalControllerOptions): TaskTerminalController {
  let mounted = false
  let currentBinding: TaskTerminalBinding | null = null
  let boundContextSignature: string | null = null
  let terminalSession: TerminalSession | null = null
  let viewAttachment: TerminalViewAttachment | null = null
  let unsubscribeShellLifecycle: (() => void) | null = null
  let lifecycle = initialLifecycle
  let bindRun = 0
  let previousIsActive: boolean | null = null
  let activatingSession: TerminalSession | null = null
  let restarting = false

  function isCurrentBinding(binding: TaskTerminalBinding): boolean {
    return mounted
      && currentBinding !== null
      && boundContextSignature === bindingContextSignature(binding)
      && bindingContextSignature(currentBinding) === bindingContextSignature(binding)
  }

  function updateLifecycle(state: ShellLifecycleState): void {
    lifecycle = state
    onLifecycleChange(state)
  }

  function clearBindingResources(): void {
    unsubscribeShellLifecycle?.()
    unsubscribeShellLifecycle = null
    viewAttachment?.detach()
    viewAttachment = null
    terminalSession = null
    previousIsActive = null
    activatingSession = null
    restarting = false
    onRestartStateChange?.({ pending: false, error: null })
  }

  async function spawnShellPty(
    session: TerminalSession,
    binding: TaskTerminalBinding,
    shouldStart: () => boolean = () => true,
  ): Promise<void> {
    const lease = adapter.runtime.beginPtySpawn(session)
    if (!lease) return

    try {
      if (!shouldStart()) return
      adapter.runtime.markPerformancePhase('shellSpawnRequest', {
        terminalKey: binding.terminalKey,
      })
      const instanceId = await adapter.spawnShellPty(
        binding.taskId,
        binding.workspacePath,
        lease.geometry.cols,
        lease.geometry.rows,
        binding.terminalIndex,
        lease.imageProtocol,
      )
      if (shouldStart()) {
        adapter.runtime.markPerformancePhase('ptyCreation', {
          terminalKey: binding.terminalKey,
          ptyInstanceId: instanceId,
        })
      }
      await lease.started(instanceId)
      if (isCurrentBinding(binding)) {
        updateLifecycle(adapter.runtime.getShellLifecycleState(binding.terminalKey))
      }
    } finally {
      lease.cancel()
    }
  }

  async function ensureShellStarted(session: TerminalSession, binding: TaskTerminalBinding): Promise<void> {
    if (!isCurrentBinding(binding)) return
    if (adapter.runtime.getShellLifecycleState(binding.terminalKey).shellExited) return
    if (adapter.runtime.canAutoStartShell?.(binding.terminalKey) === false) return
    await spawnShellPty(session, binding, () => isCurrentBinding(binding))
  }

  async function activateTerminal(session: TerminalSession, binding: TaskTerminalBinding): Promise<void> {
    if (activatingSession === session) return
    activatingSession = session
    try {
      const attachment = await adapter.runtime.attach(session, terminalHost)
      if (terminalSession !== session || !isCurrentBinding(binding)) {
        attachment.detach()
        return
      }
      viewAttachment = attachment
      await attachment.refit()
      if (terminalSession !== session || !isCurrentBinding(binding)) return
      await ensureShellStarted(session, binding)
    } finally {
      if (activatingSession === session) activatingSession = null
    }
  }

  async function bind(binding: TaskTerminalBinding): Promise<void> {
    const currentRun = ++bindRun
    clearBindingResources()
    boundContextSignature = bindingContextSignature(binding)

    const session = await adapter.runtime.acquire(binding.terminalKey)
    if (bindRun !== currentRun || !isCurrentBinding(binding)) return

    terminalSession = session
    updateLifecycle(adapter.runtime.getShellLifecycleState(binding.terminalKey))
    unsubscribeShellLifecycle = adapter.runtime.subscribeShellLifecycle(binding.terminalKey, (state) => {
      if (terminalSession !== session || !isCurrentBinding(binding)) return
      updateLifecycle(state)
    })

    if (currentBinding?.isActive) {
      await activateTerminal(session, binding)
      if (bindRun !== currentRun || !isCurrentBinding(binding)) return
    }

    previousIsActive = currentBinding?.isActive ?? false
  }

  function sync(binding: TaskTerminalBinding): void {
    currentBinding = binding
    if (!mounted) return
    if (boundContextSignature !== bindingContextSignature(binding)) {
      void bind(binding)
      return
    }

    const session = terminalSession
    if (!session) return

    updateLifecycle(adapter.runtime.getShellLifecycleState(binding.terminalKey))
    if (binding.isActive && (!previousIsActive || viewAttachment === null)) {
      void activateTerminal(session, binding)
    }
    previousIsActive = binding.isActive
  }

  function mount(binding: TaskTerminalBinding): void {
    mounted = true
    sync(binding)
  }

  async function restart(): Promise<void> {
    const session = terminalSession
    const binding = currentBinding
    if (!session || !binding || lifecycle.ptyActive || restarting) return
    restarting = true
    const currentRun = bindRun
    const isCurrentRestart = () => bindRun === currentRun
      && terminalSession === session && isCurrentBinding(binding)

    onRestartStateChange?.({ pending: true, error: null })
    let terminated = false
    try {
      await adapter.killPty(binding.terminalKey)
      if (!isCurrentRestart()) return
      terminated = true
      await adapter.runtime.resetPresentation(session)
      if (!isCurrentRestart()) return
      await spawnShellPty(session, binding, isCurrentRestart)
      if (isCurrentRestart()) onRestartStateChange?.({ pending: false, error: null })
    } catch (error) {
      if (!isCurrentRestart()) return
      const details = error instanceof Error ? error.message : String(error)
      const message = terminated
        ? 'Could not restart the shell. Retry restarting the shell.'
        : 'Could not confirm shell termination. Terminal output was kept. Retry restarting the shell.'
      onRestartStateChange?.({ pending: false, error: `${message} Details: ${details}` })
      console.error('[TaskTerminal] Failed to restart shell:', error)
    } finally {
      if (isCurrentRestart()) restarting = false
    }
  }

  function destroy(): void {
    mounted = false
    currentBinding = null
    boundContextSignature = null
    bindRun += 1
    clearBindingResources()
  }

  function getSnapshot(): TaskTerminalControllerSnapshot {
    return { boundTerminalKey: boundContextSignature === null ? null : currentBinding?.terminalKey ?? null, lifecycle }
  }

  return { mount, sync, restart, destroy, getSnapshot }
}
