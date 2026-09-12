<script lang="ts">
  import { parseCheckRuns, splitCheckRuns } from '../../../lib/types'

  interface Props {
    ciCheckRuns: string | null
    variant?: 'compact' | 'detail'
  }

  let { ciCheckRuns, variant = 'detail' }: Props = $props()

  let checkRuns = $derived(parseCheckRuns(ciCheckRuns))
  let checkSummary = $derived(splitCheckRuns(checkRuns))
</script>

{#if checkSummary.visible.length > 0 || checkSummary.passingCount > 0}
  {#if variant === 'detail'}
    <div class="border-t border-of-border/70 px-2.5 py-2 flex flex-col gap-1" aria-label="Pipeline checks">
      <div class="text-[0.7rem] font-medium text-of-text/55">Pipeline checks</div>
      {#each checkSummary.visible as check (check.id)}
        <div class="flex items-center gap-2 text-xs">
          <span class="font-semibold {check.conclusion === 'failure' ? 'text-of-danger' : check.status !== 'completed' ? 'text-of-warning' : 'text-of-text/50'}">
            {#if check.conclusion === 'failure'}Failed
            {:else if check.status !== 'completed'}Running
            {:else}Skipped{/if}
          </span>
          <span class="text-of-text/70">{check.name}</span>
        </div>
      {/each}
      {#if checkSummary.passingCount > 0}
        <div class="flex items-center gap-2 text-xs">
          <span class="font-semibold text-of-success">Passed</span>
          <span class="text-of-text/50">{checkSummary.passingCount} passing</span>
        </div>
      {/if}
    </div>
  {:else}
    <div class="flex flex-col gap-1 pl-1">
      {#each checkSummary.visible as check (check.id)}
        <div class="flex items-center gap-1.5 font-mono text-[10px]">
          <span class="{check.conclusion === 'failure' ? 'text-of-danger' : check.status !== 'completed' ? 'text-of-warning' : 'text-of-text/40'}">
            {#if check.conclusion === 'failure'}✗
            {:else if check.status !== 'completed'}⏳
            {:else}—{/if}
          </span>
          <span class="text-of-text/70">{check.name}</span>
        </div>
      {/each}
      {#if checkSummary.passingCount > 0}
        <div class="flex items-center gap-1.5 font-mono text-[10px]">
          <span class="text-of-success">✓</span>
          <span class="text-of-text/40">{checkSummary.passingCount} passing</span>
        </div>
      {/if}
    </div>
  {/if}
{/if}
