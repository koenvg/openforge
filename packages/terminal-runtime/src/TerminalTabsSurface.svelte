<script lang="ts">
  import type { Component } from 'svelte'
  import TerminalTabsShell from './TerminalTabsShell.svelte'
  import TerminalTabsTaskTerminal from './TerminalTabsTaskTerminal.svelte'
  import type { TerminalSurfaceAdapter } from './terminalSurfaceAdapter'
  import { provideTerminalSurfaceContext } from './terminalSurfaceContext'

  interface TaskTerminalProps {
    taskId: string
    workspacePath: string
    terminalKey: string
    terminalIndex: number
    isActive: boolean
  }

  interface Props {
    adapter: TerminalSurfaceAdapter
    taskId: string
    workspacePath: string
    shortcutHintsVisible: boolean
    showShellReadyAffordance?: boolean
    TaskTerminalComponent?: Component<TaskTerminalProps>
    onTabChange: ((index: number) => void) | null
    onTabCountChange: ((count: number) => void) | null
  }

  interface TerminalTabsShellHandle {
    addTab(): void
    switchToTab(tabPosition: number): void
    focusActiveTab(): void
    closeActiveTab(): Promise<void>
  }

  let {
    adapter,
    taskId,
    workspacePath,
    shortcutHintsVisible,
    showShellReadyAffordance = false,
    TaskTerminalComponent = TerminalTabsTaskTerminal,
    onTabChange,
    onTabCountChange,
  }: Props = $props()
  let terminalTabsShell = $state<TerminalTabsShellHandle | null>(null)

  provideTerminalSurfaceContext({
    get adapter() { return adapter },
    get showShellReadyAffordance() { return showShellReadyAffordance },
  })

  export function addTab() {
    terminalTabsShell?.addTab()
  }

  export function switchToTab(tabPosition: number) {
    terminalTabsShell?.switchToTab(tabPosition)
  }

  export function focusActiveTab() {
    terminalTabsShell?.focusActiveTab()
  }

  export async function closeActiveTab() {
    await terminalTabsShell?.closeActiveTab()
  }
</script>

<TerminalTabsShell
  bind:this={terminalTabsShell}
  {taskId}
  {workspacePath}
  {shortcutHintsVisible}
  {TaskTerminalComponent}
  getTaskTerminalTabsSession={adapter.runtime.getTaskTerminalTabsSession}
  updateTaskTerminalTabsSession={adapter.runtime.updateTaskTerminalTabsSession}
  getShellLifecycleState={adapter.runtime.getShellLifecycleState}
  subscribeShellLifecycle={adapter.runtime.subscribeShellLifecycle}
  killPty={adapter.killPty}
  releaseTerminal={adapter.runtime.release}
  focusTerminal={adapter.runtime.focusTerminal}
  onTabChange={(index) => onTabChange?.(index)}
  onTabCountChange={(count) => onTabCountChange?.(count)}
/>
