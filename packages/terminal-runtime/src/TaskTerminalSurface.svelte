<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { onMount, onDestroy } from 'svelte'
  import './xterm.css'
  import {
    TERMINAL_FOCUS_DESCRIPTION_TEXT,
    getRestartShellAriaLabel,
    getRestartShellTitle,
    getShellLabel,
    getTerminalFocusDescriptionId,
    getTerminalRegionAriaLabel,
    getTerminalRegionTitle,
    shouldShowShellReadyAffordance,
  } from './terminalControls'
  import {
    createTaskTerminalController,
    type TaskTerminalBinding,
    type TaskTerminalController,
  } from './taskTerminalController'
  import type { ShellLifecycleState } from './terminalRuntime'
  import type { TerminalSurfaceAdapter } from './terminalSurfaceAdapter'

  interface Props {
    adapter: TerminalSurfaceAdapter
    taskId: string
    workspacePath: string
    terminalKey: string
    terminalIndex: number
    isActive: boolean
    showShellReadyAffordance?: boolean
  }

  let {
    adapter,
    taskId,
    workspacePath,
    terminalKey,
    terminalIndex,
    isActive,
    showShellReadyAffordance = false,
  }: Props = $props()

  let terminalEl: HTMLDivElement
  let terminalController: TaskTerminalController | null = null
  let boundAdapter: TerminalSurfaceAdapter | null = null
  let componentMounted = false
  let lifecycle = $state<ShellLifecycleState>({
    ptyActive: false,
    shellExited: false,
    currentPtyInstance: null,
    hasOutput: false,
  })
  let showReadyAffordance = $derived(showShellReadyAffordance && shouldShowShellReadyAffordance(isActive, lifecycle))

  const shellLabel = $derived(getShellLabel(terminalIndex))
  const focusDescriptionId = $derived(getTerminalFocusDescriptionId(terminalKey))
  const terminalRegionLabel = $derived(getTerminalRegionAriaLabel(shellLabel))
  const terminalRegionTitle = $derived(getTerminalRegionTitle(shellLabel))
  const restartShellLabel = $derived(getRestartShellAriaLabel(shellLabel))
  const restartShellTitle = $derived(getRestartShellTitle(shellLabel))

  function currentBinding(): TaskTerminalBinding {
    return { taskId, workspacePath, terminalKey, terminalIndex, isActive }
  }

  function createController(nextAdapter: TerminalSurfaceAdapter): TaskTerminalController {
    boundAdapter = nextAdapter
    return createTaskTerminalController({
      adapter: nextAdapter,
      terminalHost: terminalEl,
      onLifecycleChange: (state) => { lifecycle = state },
    })
  }

  onMount(() => {
    componentMounted = true
    terminalController = createController(adapter)
    terminalController.mount(currentBinding())
  })

  $effect(() => {
    const binding = currentBinding()
    const nextAdapter = adapter
    if (!componentMounted) return

    if (boundAdapter !== nextAdapter) {
      terminalController?.destroy()
      terminalController = createController(nextAdapter)
      terminalController.mount(binding)
      return
    }

    terminalController?.sync(binding)
  })

  onDestroy(() => {
    componentMounted = false
    terminalController?.destroy()
    terminalController = null
    boundAdapter = null
  })

  function handleRestart(): void {
    void terminalController?.restart()
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
    {#if showReadyAffordance}
      <div class="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-box bg-base-200/90 px-3 py-2 shadow-sm z-[1]">
        <span class="font-mono text-sm text-primary" aria-hidden="true">$</span>
        <div class="flex flex-col leading-tight">
          <span class="text-sm font-medium text-base-content">Shell ready</span>
          <span class="text-xs text-base-content/60">Type a command to begin</span>
        </div>
      </div>
    {/if}
    {#if lifecycle.shellExited}
      <div class="absolute bottom-3 right-3 flex items-center gap-2 rounded-box bg-base-200/95 px-3 py-2 shadow z-[1]">
        <span class="text-sm font-mono text-base-content/70">Shell exited</span>
        <Button
          variant="ghost"
          size="sm"
          class="font-mono"
          type="button"
          onclick={handleRestart}
          aria-label={restartShellLabel}
          title={restartShellTitle}
        >
          Restart shell
        </Button>
      </div>
    {/if}
  </div>
</div>
