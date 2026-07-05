<script lang="ts">
  import TerminalTabsShell from '@openforge-app/terminal-runtime/TerminalTabsShell'
  import { commandHeld } from '../../lib/stores'
  import { killPty } from '../../lib/ipc'
  import {
    release,
    focusTerminal,
    getTaskTerminalTabsSession,
    getShellLifecycleState,
    subscribeShellLifecycle,
    updateTaskTerminalTabsSession,
  } from '../../lib/terminalPool'
  import TaskTerminal from './TaskTerminal.svelte'

  interface Props {
    taskId: string
    workspacePath: string
    onTabChange: ((index: number) => void) | null
    onTabCountChange: ((count: number) => void) | null
  }

  interface TerminalTabsShellHandle {
    addTab(): void
    switchToTab(tabPosition: number): void
    focusActiveTab(): void
    closeActiveTab(): Promise<void>
  }

  let { taskId, workspacePath, onTabChange, onTabCountChange }: Props = $props()
  let terminalTabsShell = $state<TerminalTabsShellHandle | null>(null)

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
  shortcutHintsVisible={$commandHeld}
  TaskTerminalComponent={TaskTerminal}
  {getTaskTerminalTabsSession}
  {updateTaskTerminalTabsSession}
  {getShellLifecycleState}
  {subscribeShellLifecycle}
  {killPty}
  releaseTerminal={release}
  {focusTerminal}
  onTabChange={(index) => onTabChange?.(index)}
  onTabCountChange={(count) => onTabCountChange?.(count)}
/>
