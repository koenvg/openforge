<script lang="ts">
  import { flushSync } from 'svelte'
  import { DropdownMenu } from 'bits-ui'

  let open = $state(true)
  let contentVersion = $state(0)
  let revision = $state(0)
  let dismissals = $state(0)

  function rerenderDuringPointerdown() {
    revision += 1
    flushSync()
  }
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger>Lifecycle actions</DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      aria-label="Lifecycle actions"
      style={`--registration-revision: ${revision}`}
      onInteractOutside={() => { dismissals += 1 }}
    >
      {#snippet child({ props })}
        {#key contentVersion}
          <div {...props} data-content-version={contentVersion}>
            <button onpointerdown={() => { contentVersion += 1 }}>Replace content</button>
            <output aria-label="Content revision">{revision}</output>
          </div>
        {/key}
      {/snippet}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
<button style="position: absolute; right: 0; top: 0" onpointerdown={rerenderDuringPointerdown}>Rerender outside</button>
<output aria-label="Dismissal count">{dismissals}</output>
<output aria-label="Revision count">{revision}</output>
<output aria-label="Menu open">{String(open)}</output>
