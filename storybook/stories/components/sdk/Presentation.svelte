<script lang="ts">
  import Badge from '../../../../packages/plugin-sdk/src/ui/Badge.svelte'
  import StatusBadge from '../../../../packages/plugin-sdk/src/ui/StatusBadge.svelte'
  import Panel from '../../../../packages/plugin-sdk/src/ui/Panel.svelte'
  import FileTypeIcon from '../../../../packages/plugin-sdk/src/ui/FileTypeIcon.svelte'
  import SettingsFrame from '../../../shared/frames/SettingsFrame.svelte'

  let { overflow = false }: { overflow?: boolean } = $props()
  const badges = ['neutral', 'info', 'success', 'warning', 'danger', 'status-neutral', 'status-running', 'status-warning', 'status-danger', 'status-success'] as const
  const statusBadges = [
    ['pending', 'Pending'],
    ['failed', 'Failed'],
    ['success', 'Success'],
    ['in-progress', 'In progress'],
    ['in-review', 'In review'],
    ['submitted', 'Submitted'],
    ['expired', 'Expired'],
  ] as const
  const panels = ['default', 'subtle', 'raised'] as const
  const files = ['index.ts', 'App.svelte', 'main.rs', 'README.md', 'package.json', 'image.png', 'unknown.extension']
</script>

<SettingsFrame title="Badges, panels, and file icons" description="Semantic variants and status colors, panel slots and padding, known and fallback file types, and open/closed folders.">
  <div class="space-y-5" data-testid="sdk-presentation">
    <section class="space-y-2" aria-labelledby="status-badges-heading">
      <h3 id="status-badges-heading" class="text-sm font-semibold">Status badges</h3>
      <div class="overflow-x-auto">
        <div class="flex w-max min-w-full items-center gap-3">
          {#each statusBadges as [status, label]}
            <StatusBadge {status}>{label}</StatusBadge>
          {/each}
        </div>
      </div>
    </section>
    <section class="space-y-2" aria-labelledby="badge-variants-heading">
      <h3 id="badge-variants-heading" class="text-sm font-semibold">Badge variants</h3>
      <div class="flex flex-wrap gap-2">
        {#each badges as variant}<Badge {variant}>{variant}</Badge>{/each}
        {#if overflow}<Badge variant="warning">Waiting for a review of a task with a very long title</Badge>{/if}
      </div>
    </section>
    {#each panels as variant}
      <Panel {variant}>
        {#snippet header()}{variant} panel{/snippet}
        {overflow ? 'A long panel description that should wrap in a constrained settings section. '.repeat(3) : 'Panel content uses the production spacing and color tokens.'}
        {#snippet footer()}Panel footer{/snippet}
      </Panel>
    {/each}
    <Panel padding="none"><div class="p-2">Caller-padded panel content</div></Panel>
    <ul class="flex flex-wrap gap-4" aria-label="File type examples">
      {#each files as filename}
        <li class="flex items-center gap-2"><FileTypeIcon {filename} class="size-5" />{filename}</li>
      {/each}
      <li class="flex items-center gap-2"><FileTypeIcon folder class="size-5" />Closed folder</li>
      <li class="flex items-center gap-2"><FileTypeIcon folder open class="size-5" />Open folder</li>
    </ul>
  </div>
</SettingsFrame>
