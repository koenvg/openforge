<script lang="ts">
  import TerminalTaskPaneSurface from '@openforge-app/terminal-runtime/TerminalTaskPaneSurface'
  import { commandHeld } from './lib/stores'
  import { trustedPluginTerminalSurfaceAdapter } from './terminalSurfaceAdapter'
  import TerminalTabs from './TerminalTabs.svelte'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()
</script>

<TerminalTaskPaneSurface
  adapter={trustedPluginTerminalSurfaceAdapter}
  {taskId}
  shortcutHintsVisible={$commandHeld}
  TerminalTabsComponent={TerminalTabs}
  showShellReadyAffordance
/>
