<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { TaskDetail } from '../../lib/types'
  import type { MarkdownRepositoryLinkTarget } from '@openforge-app/plugin-sdk/markdown'
  import { revealFileInTaskFiles } from '../../lib/fileViewerPlugin'
  import SelfReviewWorkspace from './SelfReviewWorkspace.svelte'
  import { createSelfReviewWorkspaceController } from './selfReviewWorkspaceController.svelte'

  interface Props {
    task: TaskDetail
    agentStatus: string | null
    onSendToAgent: (prompt: string) => void
  }

  let { task, agentStatus, onSendToAgent }: Props = $props()
  const controller = createSelfReviewWorkspaceController({
    getTaskId: () => task.id,
  })

  function openInTaskFiles(target: MarkdownRepositoryLinkTarget): Promise<boolean> {
    return revealFileInTaskFiles(task.id, target.repositoryPath, target.suffix)
  }
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

<SelfReviewWorkspace {controller} {agentStatus} {onSendToAgent} onOpenInFiles={openInTaskFiles} />
