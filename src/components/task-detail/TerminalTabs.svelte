<script lang="ts">
  import TerminalTabsSurface from '@openforge-app/terminal-runtime/TerminalTabsSurface'
  import { commandHeld } from '../../lib/stores'
  import { desktopTerminalSurfaceAdapter } from './terminalSurfaceAdapter'
  import TaskTerminal from './TaskTerminal.svelte'

  interface Props {
    taskId: string
    workspacePath: string
    onTabChange: ((index: number) => void) | null
    onTabCountChange: ((count: number) => void) | null
  }

  let props: Props = $props()
  let terminalTabsSurface = $state<TerminalTabsSurface | null>(null)

  export function addTab() {
    terminalTabsSurface?.addTab()
  }

  export function switchToTab(tabPosition: number) {
    terminalTabsSurface?.switchToTab(tabPosition)
  }

  export function focusActiveTab() {
    terminalTabsSurface?.focusActiveTab()
  }

  export async function closeActiveTab() {
    await terminalTabsSurface?.closeActiveTab()
  }
</script>

<TerminalTabsSurface
  bind:this={terminalTabsSurface}
  {...props}
  adapter={desktopTerminalSurfaceAdapter}
  shortcutHintsVisible={$commandHeld}
  TaskTerminalComponent={TaskTerminal}
/>
