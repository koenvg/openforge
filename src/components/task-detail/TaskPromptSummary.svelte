<script lang="ts">
  import type { Task } from '../../lib/types'
  import MarkdownContent from '../shared/content/MarkdownContent.svelte'

  interface Props {
    task: Task
  }

  let { task }: Props = $props()
</script>

<!-- Initial Prompt Section -->
<section class="flex flex-col gap-2.5">
  <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Initial Prompt">// INITIAL_PROMPT</h3>
  <div class="text-xs text-base-content/80 leading-relaxed whitespace-pre-wrap break-words">{task.initial_prompt}</div>
</section>

<!-- Summary Section -->
<section class="flex flex-col gap-2.5">
  <h3 class="text-[10px] font-bold text-primary font-mono tracking-[1.2px] m-0" aria-label="Summary">// SUMMARY</h3>
  {#if task.summary}
    <div class="text-sm [&_.markdown-body]:text-sm [&_.markdown-body_pre]:text-xs [&_.markdown-body_code]:text-xs [&_.markdown-body_p]:my-1">
      <MarkdownContent content={task.summary.replace(/\\n/g, '\n')} />
    </div>
  {:else}
    <div class="text-[11px] text-base-content/40">No summary yet</div>
  {/if}
</section>
