<script lang="ts">
  interface Props {
    projectName?: string
    taskActionPending?: boolean
  }

  let { projectName = '', taskActionPending = false }: Props = $props()
</script>

<div data-testid="plugin-slot-view" data-task-action-pending={taskActionPending}>Plugin view for {projectName}</div>
