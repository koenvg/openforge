<script lang="ts">
  import type { PluginSidebarNavigationProps } from '@openforge-app/plugin-sdk'

  let { active, collapsed, context, view, onActivate }: PluginSidebarNavigationProps = $props()
</script>

<button
  type="button"
  aria-label={`Custom ${view.title}`}
  aria-current={active ? 'page' : undefined}
  data-collapsed={String(collapsed)}
  data-project-id={context.projectId ?? 'none'}
  onclick={onActivate}
>
  {view.title}
</button>
