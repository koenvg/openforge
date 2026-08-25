<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { spawnShellPty, killPty } from '../../lib/ipc'
  import '@openforge-app/terminal-runtime/xterm.css'
  import {
    TERMINAL_FOCUS_DESCRIPTION_TEXT,
    getRestartShellAriaLabel,
    getRestartShellTitle,
    getShellLabel,
    getTerminalFocusDescriptionId,
    getTerminalRegionAriaLabel,
    getTerminalRegionTitle,
  } from '@openforge-app/terminal-runtime'
  import { acquire, attach, detach, recoverActiveTerminal, resetTerminal, markPtySpawnPending, clearPtySpawnPending, shouldSpawnPty, markShellPtyStarted, getShellLifecycleState, getTerminalImageProtocol, subscribeShellLifecycle, type PoolEntry, type ShellLifecycleState } from '../../lib/terminalPool'

  interface Props {
    taskId: string
    workspacePath: string
    terminalKey: string
    terminalIndex: number
    isActive: boolean
  }

  let { taskId, workspacePath, terminalKey, terminalIndex, isActive }: Props = $props()

  let terminalEl: HTMLDivElement
  let unsubscribeShellLifecycle: (() => void) | null = null
  let poolEntry = $state.raw<PoolEntry | null>(null)
  let mounted = $state(false)
  let lifecycle = $state<ShellLifecycleState>({ ptyActive: false, shellExited: false, currentPtyInstance: null, hasOutput: false })
  let previousIsActive: boolean | null = null
  let activatingEntry: PoolEntry | null = null
  let boundTerminalKey = $state<string | null>(null)
  let boundContextSignature = $state<string | null>(null)
  let bindRun = 0

  const shellLabel = $derived(getShellLabel(terminalIndex))
  const focusDescriptionId = $derived(getTerminalFocusDescriptionId(terminalKey))
  const terminalRegionLabel = $derived(getTerminalRegionAriaLabel(shellLabel))
  const terminalRegionTitle = $derived(getTerminalRegionTitle(shellLabel))
  const restartShellLabel = $derived(getRestartShellAriaLabel(shellLabel))
  const restartShellTitle = $derived(getRestartShellTitle(shellLabel))

  interface TerminalBindingContext {
    taskId: string
    workspacePath: string
    terminalKey: string
    terminalIndex: number
  }

  function currentBindingContext(): TerminalBindingContext {
    return { taskId, workspacePath, terminalKey, terminalIndex }
  }

  function bindingContextSignature(context: TerminalBindingContext): string {
    return `${context.taskId}\u0000${context.workspacePath}\u0000${context.terminalKey}\u0000${context.terminalIndex}`
  }

  function isCurrentBindingContext(context: TerminalBindingContext): boolean {
    return mounted
      && boundTerminalKey === context.terminalKey
      && terminalKey === context.terminalKey
      && taskId === context.taskId
      && workspacePath === context.workspacePath
      && terminalIndex === context.terminalIndex
  }

  function syncLifecycleState(key: string = boundTerminalKey ?? terminalKey) {
    lifecycle = getShellLifecycleState(key)
  }

  async function activateTerminal(entry: PoolEntry, context: TerminalBindingContext = currentBindingContext()) {
    if (activatingEntry === entry) return
    activatingEntry = entry
    try {
      const wasAttached = entry.attached
      await attach(entry, terminalEl)
      if (poolEntry !== entry || !isCurrentBindingContext(context)) return
      if (wasAttached) {
        await recoverActiveTerminal(entry)
        if (poolEntry !== entry || !isCurrentBindingContext(context)) return
      }
      await ensureShellStarted(entry, context)
    } finally {
      if (activatingEntry === entry) activatingEntry = null
    }
  }

  async function ensureShellStarted(entry: PoolEntry, context: TerminalBindingContext) {
    if (!isCurrentBindingContext(context) || !shouldSpawnPty(entry)) return

    markPtySpawnPending(entry)
    try {
      if (!isCurrentBindingContext(context)) return
      const instanceId = await spawnShellPty(
        context.taskId,
        context.workspacePath,
        entry.view.geometry.cols,
        entry.view.geometry.rows,
        context.terminalIndex,
        getTerminalImageProtocol(entry),
      )
      markShellPtyStarted(entry, instanceId)
      if (isCurrentBindingContext(context)) syncLifecycleState(context.terminalKey)
    } finally {
      clearPtySpawnPending(entry)
    }
  }

  function clearComponentTerminalResources() {
    unsubscribeShellLifecycle?.()
    unsubscribeShellLifecycle = null
    if (poolEntry) {
      detach(poolEntry)
      poolEntry = null
    }
    previousIsActive = null
    activatingEntry = null
  }

  async function bindToTerminalKey(nextTerminalKey: string) {
    const currentRun = bindRun + 1
    bindRun = currentRun
    clearComponentTerminalResources()
    const context = currentBindingContext()
    boundTerminalKey = nextTerminalKey
    boundContextSignature = bindingContextSignature(context)

    const entry = await acquire(nextTerminalKey)
    if (bindRun !== currentRun || !isCurrentBindingContext(context)) return

    poolEntry = entry
    syncLifecycleState(nextTerminalKey)

    unsubscribeShellLifecycle = subscribeShellLifecycle(nextTerminalKey, (state: ShellLifecycleState) => {
      if (!poolEntry || boundTerminalKey !== nextTerminalKey) return
      lifecycle = state
    })

    if (isActive) {
      await activateTerminal(entry, context)
      if (bindRun !== currentRun || !isCurrentBindingContext(context)) return
    }

    previousIsActive = isActive

    if (!mounted || bindRun !== currentRun || boundTerminalKey !== nextTerminalKey) {
      unsubscribeShellLifecycle?.()
      unsubscribeShellLifecycle = null
    }
  }

  onMount(() => {
    mounted = true
  })

  $effect(() => {
    if (!mounted) return

    const context = currentBindingContext()
    if (boundContextSignature !== bindingContextSignature(context)) {
      void bindToTerminalKey(terminalKey)
      return
    }

    const entry = poolEntry
    if (!entry) return

    syncLifecycleState(boundTerminalKey)

    const needsActiveHostRestore = isActive && !entry.view.isMountedIn(terminalEl)
    if (previousIsActive === null) {
      if (needsActiveHostRestore) void activateTerminal(entry, context)
      previousIsActive = isActive
      return
    }

    if ((!previousIsActive && isActive) || needsActiveHostRestore) {
      void activateTerminal(entry, context)
    }

    previousIsActive = isActive
  })

  onDestroy(() => {
    mounted = false
    bindRun += 1
    clearComponentTerminalResources()
    boundTerminalKey = null
    boundContextSignature = null
  })

  async function handleRestart() {
    const entry = poolEntry
    const context = currentBindingContext()
    if (!entry || lifecycle.ptyActive) return
    try {
      await killPty(context.terminalKey).catch(e => {
        console.error('[TaskTerminal] Failed to kill PTY on restart:', e)
      })
      resetTerminal(entry)
      markPtySpawnPending(entry)
      const instanceId = await spawnShellPty(
        context.taskId,
        context.workspacePath,
        entry.view.geometry.cols,
        entry.view.geometry.rows,
        context.terminalIndex,
        getTerminalImageProtocol(entry),
      )
      markShellPtyStarted(entry, instanceId)
      if (isCurrentBindingContext(context)) syncLifecycleState(context.terminalKey)
    } catch (e) {
      console.error('[TaskTerminal] Failed to restart shell:', e)
    } finally {
      clearPtySpawnPending(entry)
    }
  }
</script>

<div class="flex flex-col h-full">
  <p id={focusDescriptionId} class="sr-only">{TERMINAL_FOCUS_DESCRIPTION_TEXT}</p>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (terminal regions are intentionally keyboard-focusable landmarks) -->
  <div
    class="flex-1 overflow-hidden min-h-0 relative rounded focus-within:ring-2 focus-within:ring-primary focus-visible:ring-2 focus-visible:ring-primary focus:outline-none"
    role="region"
    tabindex="0"
    aria-label={terminalRegionLabel}
    aria-describedby={focusDescriptionId}
    title={terminalRegionTitle}
  >
    <div class="shell-terminal-wrapper w-full h-full p-3 bg-base-100" bind:this={terminalEl}></div>
    {#if lifecycle.shellExited}
      <div class="absolute bottom-3 right-3 flex items-center gap-2 rounded-box bg-base-200/95 px-3 py-2 shadow z-[1]">
        <span class="text-sm font-mono text-base-content/70">Shell exited</span>
        <button
          type="button"
          class="btn btn-sm btn-ghost text-primary font-mono focus-visible:ring-2 focus-visible:ring-primary"
          onclick={handleRestart}
          aria-label={restartShellLabel}
          title={restartShellTitle}
        >
          Restart shell
        </button>
      </div>
    {/if}
  </div>
</div>
