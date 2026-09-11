<script lang="ts">
  import { untrack } from 'svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import AnchoredMenu from '@openforge-app/plugin-sdk/ui/AnchoredMenu.svelte'
  import Tooltip from '@openforge-app/plugin-sdk/ui/Tooltip.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'

  let { kind = 'modal', initiallyOpen = false, locked = false, empty = false, onAction = (_value: string) => {} }: {
    kind?: 'modal' | 'menu' | 'tooltip'
    initiallyOpen?: boolean
    locked?: boolean
    empty?: boolean
    onAction?: (value: string) => void
  } = $props()
  let open = $state(untrack(() => initiallyOpen))
  let name = $state('Weekly report')
  let pinned = $state(true)
  let lastAction = $state('No action yet')
  const items = $derived(empty ? [] : [
    { value: 'open', label: 'Open report' },
    { value: 'sync', label: 'Sync unavailable', disabled: true },
    { value: 'pin', label: 'Pin report', checked: pinned, closeOnSelect: false },
    { value: 'delete', label: 'Delete report', danger: true },
  ])
  function act(value: string) {
    if (value === 'pin') pinned = !pinned
    lastAction = value
    onAction(value)
  }

  function saveReport(event: SubmitEvent) {
    event.preventDefault()
    act(name)
    open = false
  }
</script>

<section aria-label="Report actions" class="flex flex-col items-start gap-4 p-6">
  <h2 class="text-lg font-semibold">Weekly report</h2>
  {#if kind === 'modal'}
    <Button onClick={() => { open = true }}>Edit report</Button>
    {#if open}
      <Modal
        ariaLabelledby="edit-report-title"
        ariaDescribedby="edit-report-description"
        maxWidth="36rem"
        initialFocus="input"
        closeDisabled={locked}
        onClose={() => { open = false }}
      >
        {#snippet header()}
          <div class="min-w-0 flex-1">
            <h2 id="edit-report-title" class="m-0 text-lg font-semibold tracking-tight">Edit report</h2>
            <p id="edit-report-description" class="m-0 mt-1 text-sm leading-relaxed text-base-content/65">Update the name shown in the project sidebar.</p>
          </div>
        {/snippet}
        <form id="edit-report-form" class="flex flex-col gap-5 p-5" onsubmit={saveReport}>
          <TextField label="Report name" size="lg" helperText="Use a short, recognizable name for your team." bind:value={name} />
        </form>
        {#snippet footer()}
          <Button type="submit" form="edit-report-form" size="lg">Save report</Button>
        {/snippet}
      </Modal>
    {/if}
  {:else if kind === 'menu'}
    <AnchoredMenu label="Report menu" {items} bind:open onSelect={act}>
      {#snippet trigger()}Report actions{/snippet}
    </AnchoredMenu>
  {:else}
    <Tooltip label="About reports" content="Reports use local project data. No network connection is needed." bind:open delayDuration={0} side="bottom">
      {#snippet trigger()}About reports{/snippet}
    </Tooltip>
  {/if}
  <output aria-label="Last action">{lastAction}</output>
</section>
