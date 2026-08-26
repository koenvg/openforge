<script lang="ts">
  import TerminalTaskPaneSurface from '@openforge-app/terminal-runtime/TerminalTaskPaneSurface'
  import { commandHeld } from '../../lib/stores'
  import { desktopTerminalSurfaceAdapter } from './terminalSurfaceAdapter'
  import TerminalTabs from './TerminalTabs.svelte'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()
</script>

<TerminalTaskPaneSurface
  adapter={desktopTerminalSurfaceAdapter}
  {taskId}
  shortcutHintsVisible={$commandHeld}
  TerminalTabsComponent={TerminalTabs}
/>
