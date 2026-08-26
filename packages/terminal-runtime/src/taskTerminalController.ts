import type { PoolEntry, ShellLifecycleState } from './terminalRuntime'
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

export interface TaskTerminalControllerOptions {
  adapter: TerminalSurfaceAdapter
  terminalHost: HTMLDivElement
  onLifecycleChange(state: ShellLifecycleState): void
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
}: TaskTerminalControllerOptions): TaskTerminalController {
  let mounted = false
  let currentBinding: TaskTerminalBinding | null = null
  let boundContextSignature: string | null = null
  let poolEntry: PoolEntry | null = null
  let unsubscribeShellLifecycle: (() => void) | null = null
  let lifecycle = initialLifecycle
  let bindRun = 0
  let previousIsActive: boolean | null = null
  let activatingEntry: PoolEntry | null = null

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
    if (poolEntry) {
      adapter.runtime.detach(poolEntry)
      poolEntry = null
    }
    previousIsActive = null
    activatingEntry = null
  }

  async function ensureShellStarted(entry: PoolEntry, binding: TaskTerminalBinding): Promise<void> {
    if (!isCurrentBinding(binding) || !adapter.runtime.shouldSpawnPty(entry)) return

    adapter.runtime.markPtySpawnPending(entry)
    try {
      if (!isCurrentBinding(binding)) return
      const instanceId = await adapter.spawnShellPty(
        binding.taskId,
        binding.workspacePath,
        entry.view.geometry.cols,
        entry.view.geometry.rows,
        binding.terminalIndex,
        adapter.runtime.getTerminalImageProtocol(entry),
      )
      adapter.runtime.markShellPtyStarted(entry, instanceId)
      if (isCurrentBinding(binding)) {
        updateLifecycle(adapter.runtime.getShellLifecycleState(binding.terminalKey))
      }
    } finally {
      adapter.runtime.clearPtySpawnPending(entry)
    }
  }

  async function activateTerminal(entry: PoolEntry, binding: TaskTerminalBinding): Promise<void> {
    if (activatingEntry === entry) return
    activatingEntry = entry
    try {
      const wasAttached = entry.attached
      await adapter.runtime.attach(entry, terminalHost)
      if (poolEntry !== entry || !isCurrentBinding(binding)) return
      if (wasAttached) {
        await adapter.runtime.recoverActiveTerminal(entry)
        if (poolEntry !== entry || !isCurrentBinding(binding)) return
      }
      await ensureShellStarted(entry, binding)
    } finally {
      if (activatingEntry === entry) activatingEntry = null
    }
  }

  async function bind(binding: TaskTerminalBinding): Promise<void> {
    const currentRun = ++bindRun
    clearBindingResources()
    boundContextSignature = bindingContextSignature(binding)

    const entry = await adapter.runtime.acquire(binding.terminalKey)
    if (bindRun !== currentRun || !isCurrentBinding(binding)) return

    poolEntry = entry
    updateLifecycle(adapter.runtime.getShellLifecycleState(binding.terminalKey))
    unsubscribeShellLifecycle = adapter.runtime.subscribeShellLifecycle(binding.terminalKey, (state) => {
      if (poolEntry !== entry || !isCurrentBinding(binding)) return
      updateLifecycle(state)
    })

    if (currentBinding?.isActive) {
      await activateTerminal(entry, binding)
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

    const entry = poolEntry
    if (!entry) return

    updateLifecycle(adapter.runtime.getShellLifecycleState(binding.terminalKey))
    const needsActiveHostRestore = binding.isActive && !entry.view.isMountedIn(terminalHost)
    if (previousIsActive === null) {
      if (needsActiveHostRestore) void activateTerminal(entry, binding)
      previousIsActive = binding.isActive
      return
    }

    if ((!previousIsActive && binding.isActive) || needsActiveHostRestore) {
      void activateTerminal(entry, binding)
    }
    previousIsActive = binding.isActive
  }

  function mount(binding: TaskTerminalBinding): void {
    mounted = true
    sync(binding)
  }

  async function restart(): Promise<void> {
    const entry = poolEntry
    const binding = currentBinding
    if (!entry || !binding || lifecycle.ptyActive) return

    try {
      await adapter.killPty(binding.terminalKey).catch((error: unknown) => {
        console.error('[TaskTerminal] Failed to kill PTY on restart:', error)
      })
      adapter.runtime.resetTerminal(entry)
      adapter.runtime.markPtySpawnPending(entry)
      const instanceId = await adapter.spawnShellPty(
        binding.taskId,
        binding.workspacePath,
        entry.view.geometry.cols,
        entry.view.geometry.rows,
        binding.terminalIndex,
        adapter.runtime.getTerminalImageProtocol(entry),
      )
      adapter.runtime.markShellPtyStarted(entry, instanceId)
      if (isCurrentBinding(binding)) {
        updateLifecycle(adapter.runtime.getShellLifecycleState(binding.terminalKey))
      }
    } catch (error) {
      console.error('[TaskTerminal] Failed to restart shell:', error)
    } finally {
      adapter.runtime.clearPtySpawnPending(entry)
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
