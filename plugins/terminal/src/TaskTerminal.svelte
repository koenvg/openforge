<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
  import type { ShellSessionIdentity } from '@openforge/plugin-sdk'
  import '@xterm/xterm/css/xterm.css'
  import { acquire, attach, detach, recoverActiveTerminal, markPtySpawnPending, clearPtySpawnPending, shouldSpawnPty, markShellPtyStarted, getShellLifecycleState, subscribeShellLifecycle, type PoolEntry, type ShellLifecycleState } from './lib/terminalPool'

  interface Props {
    api: FrontendOpenForgeAPI
    session: ShellSessionIdentity
    workspacePath: string
    isActive: boolean
    onExit?: () => void
  }

  let { api, session, workspacePath, isActive, onExit }: Props = $props()

  let terminalEl: HTMLDivElement
  let unsubscribeShellLifecycle: (() => void) | null = null
  let poolEntry = $state.raw<PoolEntry | null>(null)
  let mounted = $state(false)
  let lifecycle = $state({ ptyActive: false, shellExited: false, currentPtyInstance: null as number | null })
  let previousIsActive: boolean | null = null
  let activatingEntry: PoolEntry | null = null
  let boundSessionId = $state<string | null>(null)
  let boundContextSignature = $state<string | null>(null)
  let bindRun = 0

  interface TerminalBindingContext {
    session: ShellSessionIdentity
    workspacePath: string
  }

  function currentBindingContext(): TerminalBindingContext {
    return { session, workspacePath }
  }

  function bindingContextSignature(context: TerminalBindingContext): string {
    return `${context.session.id}\u0000${context.workspacePath}`
  }

  function isCurrentBindingContext(context: TerminalBindingContext): boolean {
    return mounted
      && boundSessionId === context.session.id
      && session.id === context.session.id
      && workspacePath === context.workspacePath
  }

  function syncLifecycleState(sessionId: string = boundSessionId ?? session.id) {
    lifecycle = getShellLifecycleState(sessionId)
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
      const instanceId = await api.shell.spawn({ session: context.session, cwd: context.workspacePath, cols: entry.terminal.cols, rows: entry.terminal.rows })
      markShellPtyStarted(entry, instanceId)
      if (isCurrentBindingContext(context)) syncLifecycleState(context.session.id)
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

  async function bindToTerminalSession(nextSession: ShellSessionIdentity) {
    const currentRun = bindRun + 1
    bindRun = currentRun
    clearComponentTerminalResources()
    const context = currentBindingContext()
    boundSessionId = nextSession.id
    boundContextSignature = bindingContextSignature(context)

    const entry = await acquire(nextSession, api)
    if (bindRun !== currentRun || !isCurrentBindingContext(context)) return

    poolEntry = entry
    syncLifecycleState(nextSession.id)

    unsubscribeShellLifecycle = subscribeShellLifecycle(nextSession.id, (state: ShellLifecycleState) => {
      if (!poolEntry || boundSessionId !== nextSession.id) return
      const wasExited = lifecycle.shellExited
      lifecycle = state
      if (!wasExited && state.shellExited) onExit?.()
    })

    if (isActive) {
      await activateTerminal(entry, context)
      if (bindRun !== currentRun || !isCurrentBindingContext(context)) return
    }

    previousIsActive = isActive

    if (!mounted || bindRun !== currentRun || boundSessionId !== nextSession.id) {
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
      void bindToTerminalSession(session)
      return
    }

    const entry = poolEntry
    if (!entry) return

    syncLifecycleState(boundSessionId ?? session.id)

    const needsActiveHostRestore = isActive && entry.hostDiv.parentNode !== terminalEl
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
    boundSessionId = null
    boundContextSignature = null
  })

  async function handleRestart() {
    const entry = poolEntry
    const context = currentBindingContext()
    if (!entry || lifecycle.ptyActive) return
    try {
      await api.shell.kill({ session: context.session }).catch(e => {
        console.error('[TaskTerminal] Failed to kill shell on restart:', e)
      })
      markPtySpawnPending(entry)
      const instanceId = await api.shell.spawn({ session: context.session, cwd: context.workspacePath, cols: entry.terminal.cols, rows: entry.terminal.rows })
      markShellPtyStarted(entry, instanceId)
      if (isCurrentBindingContext(context)) syncLifecycleState(context.session.id)
    } catch (e) {
      console.error('[TaskTerminal] Failed to restart shell:', e)
    } finally {
      clearPtySpawnPending(entry)
    }
  }
</script>

<div class="flex flex-col h-full">
  <div class="flex-1 overflow-hidden min-h-0 relative">
    <div class="shell-terminal-wrapper w-full h-full p-3 bg-base-100" bind:this={terminalEl}></div>
    {#if lifecycle.shellExited}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-base-100/90 z-[1]">
        <span class="text-sm font-mono text-base-content/70">Shell exited</span>
        <button class="btn btn-sm btn-ghost text-primary font-mono" onclick={handleRestart}>
          Restart
        </button>
      </div>
    {/if}
  </div>
</div>
