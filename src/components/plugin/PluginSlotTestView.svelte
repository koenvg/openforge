<script lang="ts">
  interface Props {
    projectName?: string
    taskActionPending?: boolean
    /** Set for slots whose subject is a pull request, so a test can assert which row it got. */
    pr?: { number: number } | null
  }

  let { projectName = '', taskActionPending = false, pr = null }: Props = $props()
</script>

<div
  data-testid="plugin-slot-view"
  data-task-action-pending={taskActionPending}
  data-pr-number={pr ? pr.number : null}
>Plugin view for {projectName}</div>
