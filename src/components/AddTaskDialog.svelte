<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import { HIERARCHICAL_SETTINGS } from '../lib/hierarchicalSettings'
  import { activeProjectId } from '../lib/stores'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import PromptInput from './prompt/PromptInput.svelte'
  import InjectionPointSlot from './plugin/InjectionPointSlot.svelte'
  import CreateTaskEnvironment from './create-task/CreateTaskEnvironment.svelte'
  import CreateTaskProgressiveSettings from './create-task/CreateTaskProgressiveSettings.svelte'
  import CreateTaskPromptAttachments from './create-task/CreateTaskPromptAttachments.svelte'
  import type { InjectionPointLocation } from '@openforge-app/plugin-sdk'

  import { createTaskCreationWorkflow, type TaskCreationContext } from './create-task/taskCreationWorkflow.svelte'
  import { productionTaskCreationAdapter } from './create-task/productionTaskCreationAdapter'

  interface Props extends Omit<TaskCreationContext, 'projectId'> {
    projectName?: string | null
  }

  // Provider choices come from the shared settings registry so the task-level
  // control never drifts from the global/project provider options.
  const aiProviderOptions = HIERARCHICAL_SETTINGS.find((setting) => setting.key === 'ai_provider')?.options ?? []

  let { mode = 'create', task = null, projectPath = null, projectName = null, promptSeed = '', sourceTicketUrlSeed = null, titleSeed = null, worktreeSourceSeed = null, worktreeBranchSeed = null, onClose, onTaskSaved, onRunAction }: Props = $props()
  const dialogTitle = $derived(mode === 'create' ? 'Create task' : 'Edit task')

  const workflow = createTaskCreationWorkflow(productionTaskCreationAdapter)
  const view = workflow.state
  let promptEditor = $state<{ insertText: (text: string) => void } | null>(null)
  let injectableInsertRequest = $state<{ id: number, text: string } | null>(null)
  let nextInjectableInsertRequestId = 1
  const injectionLocation = $derived<InjectionPointLocation>(mode === 'create' ? 'createTaskPrompt' : 'backlogPrompt')

  function workflowInput() {
    return { projectId: $activeProjectId, mode, task, projectPath, promptSeed, sourceTicketUrlSeed, titleSeed,
      worktreeSourceSeed, worktreeBranchSeed, onClose, onTaskSaved, onRunAction }
  }
  untrack(() => workflow.configure(workflowInput()))
  $effect(() => {
    const input = workflowInput()
    untrack(() => {
      const previousRevision = view.promptRevision
      workflow.configure(input)
      if (view.promptRevision !== previousRevision) injectableInsertRequest = null
    })
  })

  onMount(() => {
    void workflow.initialize()
    placeCaretAfterSeededPrompt()
  })
  onDestroy(() => workflow.dispose())

  /**
   * The modal focuses the textarea with the caret at position 0. A seeded prompt
   * is context the user writes *after*, so move the caret to the end.
   */
  function placeCaretAfterSeededPrompt(): void {
    if (mode !== 'create' || promptSeed.length === 0) return
    queueMicrotask(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    })
  }

</script>

<Modal
  onClose={onClose}
  maxWidth="720px"
  overflowVisible
  initialFocus="textarea"
  ariaLabel={dialogTitle}
>
  {#snippet header()}
    <div class="flex min-w-0 flex-1 items-center justify-between gap-4 pr-3">
      <h2 class="m-0 text-2xl font-semibold tracking-[-0.02em] text-[var(--of-text)]">{dialogTitle}</h2>
      {#if mode === 'create'}
        <div class="min-w-0 text-right">
          <span class="block max-w-56 truncate text-sm font-medium text-[var(--of-text)]">{projectName ?? 'Current project'}</span>
        </div>
      {/if}
    </div>
  {/snippet}

  <div class="max-h-[calc(90vh-4rem)] overflow-y-auto p-6">
    {#if view.taskDefaultsError}
      <div class="mb-4 flex items-center justify-between gap-3 rounded-[var(--of-radius-container)] border border-[var(--of-danger)] bg-[var(--of-danger-subtle)] px-3 py-2 text-sm text-[var(--of-danger)]" role="alert">
        <span>{view.taskDefaultsError}</span>
        <Button size="sm" variant="danger" type="button" onclick={() => void workflow.initialize()}>
          Retry loading defaults
        </Button>
      </div>
    {:else if view.error}
      <div class="mb-4 rounded-[var(--of-radius-container)] border border-[var(--of-danger)] bg-[var(--of-danger-subtle)] px-3 py-2 text-sm text-[var(--of-danger)]" role="alert">{view.error}</div>
    {/if}

    <InjectionPointSlot
      location={injectionLocation}
      projectId={$activeProjectId}
      taskId={mode === 'edit' && task ? task.id : null}
      onInsert={(text) => {
        injectableInsertRequest = { id: nextInjectableInsertRequestId, text }
        nextInjectableInsertRequestId += 1
      }}
    />
    <label class="mb-2 block text-sm font-semibold text-[var(--of-text)]" for="create-task-prompt">What should the agent do?</label>
    <div class="create-task-prompt-frame relative overflow-visible">
      {#key view.promptRevision}
        <PromptInput
          bind:this={promptEditor}
          projectId={$activeProjectId || ''}
          value={view.initialPrompt}
          textareaId="create-task-prompt"
          ariaLabel="What should the agent do?"
          rows={8}
          textareaClass="p-4 pb-9 text-sm leading-relaxed"
          textareaStyle="height: 12rem; max-height: 12rem; overflow-y: auto; outline: none;"
          maxLength={10000}
          placeholder="Describe the outcome you want…"
          autofocus={false}
          commandTrigger={view.draft.aiProvider === 'codex' ? 'dollar' : 'slash'}
          onTextChange={(prompt) => workflow.attachments.syncWithPrompt(prompt)}
          onPasteImage={(blob) => workflow.attachments.attachImage(blob)}
          onImageMarkerClick={(marker) => workflow.attachments.openPreview(marker)}
          imageMarkerInsertRequest={workflow.attachments.state.insertRequest}
          injectableInsertRequest={injectableInsertRequest}
          onSubmit={(prompt) => workflow.submit(mode === 'create' ? 'start' : 'backlog', prompt)}
          onValueChange={(value) => { view.promptDraft = value }}
          onCancel={() => onClose?.()}
        />
      {/key}
      <span class="pointer-events-none absolute bottom-3 right-4 text-xs tabular-nums text-[var(--of-text-muted)]">{view.promptDraft.length.toLocaleString()} / 10,000</span>
    </div>
    <p class="mt-2 text-xs text-[var(--of-text-secondary)]">Be specific about the goal, constraints, and relevant context.</p>

    <div class="flex flex-col gap-2 pb-4">
      <CreateTaskPromptAttachments
        attachments={workflow.attachments}
        onTranscription={(text) => promptEditor?.insertText(text)}
      />
      {#if mode === 'create'}
        <CreateTaskEnvironment
          bind:draft={view.draft}
          worktreeAllowed={view.worktreeAllowed}
          branchList={view.branchList}
          {aiProviderOptions}
        />
        <CreateTaskProgressiveSettings bind:draft={view.draft} />
      {/if}
    </div>
  </div>

  <footer class="flex items-center justify-between gap-4 border-t border-[var(--of-border)] bg-[var(--of-surface)] px-6 py-4">
    <div class="flex min-w-0 items-center gap-3">
      <Button type="button" variant="ghost" class="gap-2" aria-label="Close" onclick={() => onClose?.()}>
        <kbd class="kbd kbd-sm border-[var(--of-border)] bg-[var(--of-surface)]">Esc</kbd>
        Close
      </Button>
      {#if mode === 'create' && view.taskDefaultsLoading}
        <span class="truncate text-xs text-[var(--of-text-secondary)]">Loading task defaults…</span>
      {/if}
    </div>

    <div class="flex shrink-0 items-center gap-2">
      {#if mode === 'create'}
        <Button
          variant="outline"
          type="button"
          disabled={!view.promptReady || !view.createReady}
          onclick={() => workflow.submit('backlog')}
        >{view.submissionIntent === 'backlog' ? 'Adding…' : 'Add to backlog'}</Button>
        <Button
          class="min-w-36"
          type="button"
          disabled={!view.promptReady || !view.createReady}
          onclick={() => workflow.submit('start')}
          title="Command+Enter"
        >
          {view.submissionIntent === 'start' ? 'Starting…' : 'Start Task'}
          {#if view.submissionIntent !== 'start'}
            <kbd class="kbd kbd-xs ml-1 border-[var(--of-on-accent)] bg-[var(--of-on-accent)] text-[var(--of-accent)]">⌘↵</kbd>
          {/if}
        </Button>
      {:else}
        <span class="text-xs text-[var(--of-text-secondary)]">⌘Enter to submit</span>
        <Button
          size="sm"
          type="button"
          disabled={!view.promptReady || !view.createReady}
          onclick={() => workflow.submit()}
        >{view.isSaving ? 'Saving…' : 'Submit'}</Button>
      {/if}
    </div>
  </footer>
</Modal>

<style>
  .create-task-prompt-frame {
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-container);
    background: var(--of-field);
    transition: border-color var(--of-duration-fast) var(--of-ease-standard);
  }

  .create-task-prompt-frame:focus-within {
    border-color: var(--of-accent);
  }

  @media (prefers-reduced-motion: reduce) {
    .create-task-prompt-frame {
      transition: none;
    }
  }
</style>
