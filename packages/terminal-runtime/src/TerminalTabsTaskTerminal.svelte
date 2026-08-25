<script lang="ts">
  import TaskTerminalSurface from './TaskTerminalSurface.svelte'
  import { useTerminalSurfaceContext } from './terminalSurfaceContext'

  interface Props {
    taskId: string
    workspacePath: string
    terminalKey: string
    terminalIndex: number
    isActive: boolean
  }

  let props: Props = $props()
  const context = useTerminalSurfaceContext()
</script>

<TaskTerminalSurface
  {...props}
  adapter={context.adapter}
  showShellReadyAffordance={context.showShellReadyAffordance}
/>
