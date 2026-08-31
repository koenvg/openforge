<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { useAppRouter } from '../../lib/router.svelte'
  import type { TaskDetail } from '../../lib/types'
  import SelfReviewWorkspace from './SelfReviewWorkspace.svelte'
  import { createSelfReviewWorkspaceController } from './selfReviewWorkspaceController.svelte'

  interface Props {
    task: TaskDetail
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
  }

  let { task, agentStatus, onSendToAgent }: Props = $props()
  const router = useAppRouter()
  const controller = createSelfReviewWorkspaceController({
    getTaskId: () => task.id,
    navigateToFileViewer: (viewKey) => router.navigate(viewKey),
  })

  $effect(() => {
    controller.synchronizeWorkspaceState()
  })

  onMount(() => {
    void controller.load()
  })

  onDestroy(() => {
    controller.dispose()
  })
</script>

<SelfReviewWorkspace {controller} {agentStatus} {onSendToAgent} />
