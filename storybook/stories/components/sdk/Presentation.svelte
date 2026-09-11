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
      <div class="spectrum-badge-variants flex flex-wrap gap-2">
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

<style>
  /* Keep the legacy Badge comparison row on the same Spectrum palette as StatusBadge. */
  .spectrum-badge-variants {
    --of-info: #0369a1;
    --of-info-subtle: #f0f9ff;
    --of-success: #047857;
    --of-success-subtle: #ecfdf5;
    --of-warning: #b45309;
    --of-warning-subtle: #fffbeb;
    --of-danger: #be123c;
    --of-danger-subtle: #fff1f2;
    --of-status-neutral: rgb(115 115 115 / 20%);
    --of-status-neutral-subtle: #f5f5f5;
    --of-on-status-neutral: #525252;
    --of-status-running: rgb(2 132 199 / 20%);
    --of-status-running-subtle: #f0f9ff;
    --of-on-status-running: #0369a1;
    --of-status-warning: rgb(217 119 6 / 20%);
    --of-status-warning-subtle: #fffbeb;
    --of-on-status-warning: #b45309;
    --of-status-danger: rgb(225 29 72 / 20%);
    --of-status-danger-subtle: #fff1f2;
    --of-on-status-danger: #be123c;
    --of-status-success: rgb(5 150 105 / 20%);
    --of-status-success-subtle: #ecfdf5;
    --of-on-status-success: #047857;
  }

  :global([data-theme-appearance='dark']) .spectrum-badge-variants,
  :global([data-theme='openforge-dark']) .spectrum-badge-variants {
    --of-info: #7dd3fc;
    --of-info-subtle: rgb(56 189 248 / 10%);
    --of-success: #6ee7b7;
    --of-success-subtle: rgb(52 211 153 / 10%);
    --of-warning: #fcd34d;
    --of-warning-subtle: rgb(251 191 36 / 10%);
    --of-danger: #fda4af;
    --of-danger-subtle: rgb(251 113 133 / 10%);
    --of-status-neutral: rgb(212 212 212 / 20%);
    --of-status-neutral-subtle: rgb(163 163 163 / 10%);
    --of-on-status-neutral: #d4d4d4;
    --of-status-running: rgb(125 211 252 / 25%);
    --of-status-running-subtle: rgb(56 189 248 / 10%);
    --of-on-status-running: #7dd3fc;
    --of-status-warning: rgb(252 211 77 / 25%);
    --of-status-warning-subtle: rgb(251 191 36 / 10%);
    --of-on-status-warning: #fcd34d;
    --of-status-danger: rgb(253 164 175 / 25%);
    --of-status-danger-subtle: rgb(251 113 133 / 10%);
    --of-on-status-danger: #fda4af;
    --of-status-success: rgb(110 231 183 / 25%);
    --of-status-success-subtle: rgb(52 211 153 / 10%);
    --of-on-status-success: #6ee7b7;
  }
</style>
