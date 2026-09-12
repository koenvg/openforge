<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import ProjectSwitcherModal from '../../../src/components/project/ProjectSwitcherModal.svelte'
  import CommandPalette from '../../../src/components/shell/CommandPalette.svelte'
  import ActionPalette from '../../../src/components/shell/ActionPalette.svelte'
  import FileQuickOpen from '../../../src/components/shell/FileQuickOpen.svelte'
  import { createTask, createPullRequest } from '../fixtures/appFixtures'
  import { activeProjectId } from '../../../src/lib/stores'
  import type { PullRequestMergeMethod } from '../../../src/lib/types'
  import type { NavigationWorkflowKind } from '../fixtures/navigationScenario'
  import BoardPage from './BoardPage.svelte'
  import paletteThemeStylesheet from '../../../packages/plugin-sdk/src/ui/browser/search-palette-theme.css?url'

  let { workflow, state: scenarioState = 'populated', paletteTheme = false, reset, onClose = () => {}, onSelectProject = () => {}, onExecute = () => {} }: {
    workflow: NavigationWorkflowKind
    state?: string
    paletteTheme?: boolean
    reset: () => Promise<void>
    onClose?: () => void
    onSelectProject?: (id: string) => void
    onExecute?: (id: string, method?: PullRequestMergeMethod) => void
  } = $props()
  let open = $state(true)
  let generation = $state(0)

  function close() {
    open = false
    onClose()
  }
  async function reopen() {
    await reset()
    generation += 1
    open = true
  }
</script>

<svelte:head>
  {#if paletteTheme}<link rel="stylesheet" href={paletteThemeStylesheet} />{/if}
</svelte:head>

{#key generation}
<BoardPage>
  {#snippet dialogs()}
    {#if open && workflow === 'projects'}
      <ProjectSwitcherModal onClose={close} onSelectProject={(id) => {
        activeProjectId.set(id)
        onSelectProject(id)
      }} />
    {:else if open && workflow === 'commands'}
      <CommandPalette onClose={close} />
    {:else if open && workflow === 'actions'}
      <ActionPalette
        task={scenarioState === 'unavailable' ? null : createTask({ status: scenarioState === 'backlog' ? 'backlog' : 'doing' })}
        taskPrs={scenarioState === 'merge' ? [createPullRequest({
          ci_status: 'success', review_status: 'approved', mergeable: true, mergeable_state: 'clean',
          merge_methods_policy_known: true, allowed_merge_methods: '["squash","rebase"]', default_merge_method: 'squash',
        })] : []}
        canRunApp={scenarioState === 'populated'}
        onClose={close} onExecute={(id, method) => { onExecute(id, method); close() }}
      />
    {:else if open && workflow === 'files'}
      <FileQuickOpen onClose={close} />
    {:else if !open}
      <div class="fixed bottom-4 right-4 z-50">
        <Button onclick={reopen}>Reopen workflow</Button>
      </div>
    {/if}
  {/snippet}
</BoardPage>
{/key}
