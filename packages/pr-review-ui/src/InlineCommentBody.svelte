<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
  }

  let { children }: Props = $props()
</script>

<div class="text-base-content leading-relaxed text-[0.8rem] [&_p]:m-0 [&_p+p]:mt-1.5 [&_pre]:text-[0.75rem] [&_code]:text-[0.75rem] [&_pre]:bg-base-200 [&_pre]:rounded [&_pre]:p-2 [&_pre]:my-1.5 [&_code]:bg-base-200 [&_code]:px-1 [&_code]:rounded [&_ul]:my-1 [&_ol]:my-1 [&_li]:ml-4 [&_blockquote]:border-l-2 [&_blockquote]:border-base-300 [&_blockquote]:pl-3 [&_blockquote]:text-base-content/70 [&_a]:text-primary [&_a]:underline">
  {@render children()}
</div>
