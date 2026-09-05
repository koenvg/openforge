<script lang="ts">
  import { untrack, type Snippet } from 'svelte'
  import ApplicationShell from '../../../src/components/shell/ApplicationShell.svelte'
  import AppSidebar from '../../../src/components/shell/AppSidebar.svelte'
  import IconRail from '../../../src/components/shell/IconRail.svelte'
  import type { AppView } from '../../../src/lib/types'
  import type { IconRailPluginNavItem, SidebarPluginNavItem } from '../../../src/lib/iconRailNav'

  let {
    children, dialogs, overlays,
    currentView = 'board',
    initiallyCollapsed = false,
    zen = false,
    showProjectNavigation = true,
    pluginNavItems = [],
    sidebarPluginNavItems = [],
    onNavigate = () => {},
    onSelectProject = () => {},
    onNewProject = () => {},
    onOpenAttentionOverview = () => {},
  }: {
    children: Snippet
    dialogs?: Snippet
    overlays?: Snippet
    currentView?: AppView
    initiallyCollapsed?: boolean
    zen?: boolean
    showProjectNavigation?: boolean
    pluginNavItems?: IconRailPluginNavItem[]
    sidebarPluginNavItems?: SidebarPluginNavItem[]
    onNavigate?: (view: AppView) => void
    onSelectProject?: (id: string) => void
    onNewProject?: () => void
    onOpenAttentionOverview?: () => void
  } = $props()
  let collapsed = $state(untrack(() => initiallyCollapsed))
</script>

<ApplicationShell {zen} {children} {dialogs} {overlays}>
  {#snippet sidebar()}
    <AppSidebar
      {collapsed}
      {currentView}
      appMode="production"
      onToggleCollapse={() => { collapsed = !collapsed }}
      {onNavigate}
      {onSelectProject}
      {onNewProject}
      {onOpenAttentionOverview}
      pluginNavItems={sidebarPluginNavItems}
    />
  {/snippet}
  {#snippet projectNavigation()}
    {#if showProjectNavigation}
      <IconRail {currentView} {pluginNavItems} {onNavigate} />
    {/if}
  {/snippet}
</ApplicationShell>
