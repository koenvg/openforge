<script lang="ts">
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import { projects, activeProjectId, projectAttention } from '../../lib/stores'
  import SearchPalette from '@openforge-app/plugin-sdk/ui/SearchPalette.svelte'
  import type { ProjectAttention } from '../../lib/types'

  interface Props {
    onClose: () => void
    onSelectProject: (projectId: string) => void
  }

  let { onClose, onSelectProject }: Props = $props()
  let searchQuery = $state('')
  let selectedIndex = $state(-1)

  let filteredProjects = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return $projects
    return $projects.filter(project => project.name.toLowerCase().includes(q))
  })

  $effect(() => {
    if (searchQuery.trim()) {
      selectedIndex = filteredProjects.length > 0 ? 0 : -1
    } else {
      const index = filteredProjects.findIndex(project => project.id === $activeProjectId)
      selectedIndex = index >= 0 ? index : -1
    }
  })

  function getAttention(projectId: string): ProjectAttention | undefined {
    return $projectAttention.get(projectId)
  }

  function selectProject(projectId: string) {
    onSelectProject(projectId)
    onClose()
  }

</script>

<SearchPalette
  ariaLabel="Switch project" {onClose}
  items={filteredProjects}
  {selectedIndex}
  onSelectedIndexChange={(index) => { selectedIndex = index }}
  onSelect={(project) => selectProject(project.id)}
  getKey={(project) => project.id}
  listboxLabel="Projects"
  query={searchQuery}
  onQueryChange={(value) => { searchQuery = value }}
  placeholder="Switch project..."
  actionLabel="select" trailingKey="Ctrl+N/P"
 >
    {#snippet emptyContent()}
      <div class="px-4 py-6 text-center text-base-content/50 text-sm">No projects match your search</div>
    {/snippet}
    {#snippet item(project)}
      <div class="flex-1 min-w-0">
        <div class="font-medium leading-tight truncate">{project.name}</div>
        <div class="font-mono text-xs text-base-content/50 truncate mt-0.5">{project.path}</div>
      </div>
    {/snippet}
    {#snippet trailing(project)}
      {@const attn = getAttention(project.id)}
      {@const isActive = project.id === $activeProjectId}
      <span class="flex items-center gap-1.5 shrink-0">
        {#if attn}
          {#if attn.needs_input > 0}
            <span class="w-2 h-2 rounded-[var(--of-radius-round)] bg-warning" title="{attn.needs_input} agent{attn.needs_input > 1 ? 's' : ''} need{attn.needs_input === 1 ? 's' : ''} input"></span>
          {:else if attn.running_agents > 0}
            <span class="w-2 h-2 rounded-[var(--of-radius-round)] bg-success animate-pulse" title="{attn.running_agents} agent{attn.running_agents > 1 ? 's' : ''} running"></span>
          {:else if attn.completed_agents > 0}
            <span class="w-2 h-2 rounded-[var(--of-radius-round)] bg-info" title="{attn.completed_agents} agent{attn.completed_agents > 1 ? 's' : ''} completed"></span>
          {:else if attn.ci_failures > 0}
            <span class="w-2 h-2 rounded-[var(--of-radius-round)] bg-error" title="{attn.ci_failures} CI failure{attn.ci_failures > 1 ? 's' : ''}"></span>
          {:else if attn.unaddressed_comments > 0}
            <Badge variant="danger" class="text-[0.6rem]" title="{attn.unaddressed_comments} unaddressed comment{attn.unaddressed_comments > 1 ? 's' : ''}">{attn.unaddressed_comments}</Badge>
          {/if}
        {/if}
        {#if isActive}<span class="text-primary text-[0.9rem] font-bold leading-none">✓</span>{/if}
      </span>
    {/snippet}
</SearchPalette>
