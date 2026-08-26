<script lang="ts">
  import TaskTerminalSurface from '@openforge-app/terminal-runtime/TaskTerminalSurface'
  import { trustedPluginTerminalSurfaceAdapter } from './terminalSurfaceAdapter'

  interface Props {
    taskId: string
    workspacePath: string
    terminalKey: string
    terminalIndex: number
    isActive: boolean
  }

  let props: Props = $props()
</script>

<TaskTerminalSurface
  {...props}
  adapter={trustedPluginTerminalSurfaceAdapter}
  showShellReadyAffordance
/>
