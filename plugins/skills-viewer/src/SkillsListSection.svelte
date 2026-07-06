<script lang="ts">
  import type { SkillIdentity, SkillInfo, SkillSourceGroup } from './lib/skillDomain'
  import { getSkillLocationLabel, getSkillSourcePath, isSameSkillIdentity } from './lib/skillDomain'

  interface Props {
    activeProjectId: string | null
    isLoading: boolean
    error: string | null
    skillsCount: number
    filteredSkills: SkillInfo[]
    projectSkills: SkillInfo[]
    userSkills: SkillInfo[]
    projectGroups: SkillSourceGroup[]
    userGroups: SkillSourceGroup[]
    visibleSkills: SkillInfo[]
    selectedSkillIdentity: SkillIdentity | null
    collapsed: Map<string, boolean>
    focusedIndex: number
    skillFilterId: string
    searchFilter: string
    onSearchFilterChange: (value: string) => void
    onRetryLoad: () => void
    onSelectSkill: (skill: SkillInfo) => void
    onToggleCollapsed: (key: string, collapsed: boolean) => void
    hasNameCollision: (skill: SkillInfo) => boolean
    groupPanelId: (level: SkillInfo['level'], source: string) => string
  }

  let {
    activeProjectId,
    isLoading,
    error,
    skillsCount,
    filteredSkills,
    projectSkills,
    userSkills,
    projectGroups,
    userGroups,
    visibleSkills,
    selectedSkillIdentity,
    collapsed,
    focusedIndex,
    skillFilterId,
    searchFilter,
    onSearchFilterChange,
    onRetryLoad,
    onSelectSkill,
    onToggleCollapsed,
    hasNameCollision,
    groupPanelId,
  }: Props = $props()
</script>

<div class="w-72 border-r border-base-300 flex flex-col shrink-0" style="background-color: var(--project-bg, oklch(var(--b1)))">
  <div class="p-3 border-b border-base-300">
    <label for={skillFilterId} class="sr-only">Filter skills</label>
    <input
      id={skillFilterId}
      type="text"
      placeholder="Filter skills..."
      class="input input-sm input-bordered w-full"
      value={searchFilter}
      oninput={(event) => onSearchFilterChange(event.currentTarget.value)}
    />
  </div>

  {#snippet skillRow(skill: SkillInfo)}
    {@const flatIdx = visibleSkills.indexOf(skill)}
    {@const selected = isSameSkillIdentity(skill, selectedSkillIdentity)}
    <button
      data-vim-skill
      aria-current={selected ? 'true' : undefined}
      class="w-full text-left pl-8 pr-3 py-2 border-b border-base-200 hover:bg-base-200 transition-colors cursor-pointer {selected ? 'bg-primary/10 border-l-2 border-l-primary' : ''} {flatIdx === focusedIndex ? 'vim-focus' : ''}"
      onclick={() => onSelectSkill(skill)}
    >
      <span class="text-sm font-medium text-base-content truncate block">{skill.name}</span>
      {#if hasNameCollision(skill)}
        <p class="text-xs text-base-content/50 m-0 mt-0.5 line-clamp-1">{getSkillLocationLabel(skill)}</p>
      {/if}
      {#if skill.description}
        <p class="text-xs text-base-content/50 m-0 mt-0.5 line-clamp-1">{skill.description}</p>
      {/if}
    </button>
  {/snippet}

  <div class="flex-1 overflow-y-auto">
    {#if !activeProjectId}
      <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm text-center p-5">
        <span class="text-3xl">📁</span>
        <span class="font-medium text-base-content/70">Select a project</span>
        <span>Choose a project to view and edit its skills.</span>
      </div>
    {:else if isLoading && skillsCount === 0}
      <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm" role="status" aria-live="polite">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <span>Loading skills...</span>
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center h-full gap-3 text-error text-sm text-center p-5" role="alert">
        <span class="text-3xl">⚠</span>
        <span>{error}</span>
        <button class="btn btn-sm btn-outline" onclick={onRetryLoad} disabled={isLoading}>Retry loading skills</button>
      </div>
    {:else if skillsCount === 0}
      <div class="flex flex-col items-center justify-center h-full gap-4 text-base-content/50 text-center p-6">
        <span class="text-4xl">📝</span>
        <p class="text-sm m-0">No skills found. Create your first skill!</p>
      </div>
    {:else if filteredSkills.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-center p-6">
        <p class="text-sm m-0">No skills match your filter.</p>
      </div>
    {:else}
      {#if projectSkills.length > 0}
        {@const levelCollapsed = collapsed.get('project') ?? false}
        <button
          class="w-full flex items-center gap-1.5 px-3 pt-3 pb-1 cursor-pointer hover:bg-base-200/50"
          aria-expanded={!levelCollapsed}
          aria-controls="skills-project-groups"
          onclick={() => onToggleCollapsed('project', !levelCollapsed)}
        >
          <span class="text-xs text-base-content/40 transition-transform {levelCollapsed ? '' : 'rotate-90'}">&rsaquo;</span>
          <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Repository</span>
          <span class="text-xs text-base-content/30 ml-auto">{projectSkills.length}</span>
        </button>
        {#if !levelCollapsed}
          <div id="skills-project-groups">
          {#each projectGroups as group}
            {@const groupKey = `project:${group.source}`}
            {@const groupCollapsed = collapsed.get(groupKey) ?? false}
            <button
              class="w-full flex items-center gap-1.5 pl-5 pr-3 pt-2 pb-1 cursor-pointer hover:bg-base-200/50"
              aria-expanded={!groupCollapsed}
              aria-controls={groupPanelId('project', group.source)}
              onclick={() => onToggleCollapsed(groupKey, !groupCollapsed)}
            >
              <span class="text-xs text-base-content/40 transition-transform {groupCollapsed ? '' : 'rotate-90'}">&rsaquo;</span>
              <span class="text-xs font-medium text-base-content/40">{getSkillSourcePath(group.source, 'project')}</span>
              <span class="text-xs text-base-content/30 ml-auto">{group.skills.length}</span>
            </button>
            {#if !groupCollapsed}
              <div id={groupPanelId('project', group.source)}>
              {#each group.skills as skill}
                {@render skillRow(skill)}
              {/each}
              </div>
            {/if}
          {/each}
          </div>
        {/if}
      {/if}

      {#if userSkills.length > 0}
        {@const levelCollapsed = collapsed.get('user') ?? false}
        <button
          class="w-full flex items-center gap-1.5 px-3 pt-3 pb-1 cursor-pointer hover:bg-base-200/50"
          aria-expanded={!levelCollapsed}
          aria-controls="skills-user-groups"
          onclick={() => onToggleCollapsed('user', !levelCollapsed)}
        >
          <span class="text-xs text-base-content/40 transition-transform {levelCollapsed ? '' : 'rotate-90'}">&rsaquo;</span>
          <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Personal</span>
          <span class="text-xs text-base-content/30 ml-auto">{userSkills.length}</span>
        </button>
        {#if !levelCollapsed}
          <div id="skills-user-groups">
          {#each userGroups as group}
            {@const groupKey = `user:${group.source}`}
            {@const groupCollapsed = collapsed.get(groupKey) ?? false}
            <button
              class="w-full flex items-center gap-1.5 pl-5 pr-3 pt-2 pb-1 cursor-pointer hover:bg-base-200/50"
              aria-expanded={!groupCollapsed}
              aria-controls={groupPanelId('user', group.source)}
              onclick={() => onToggleCollapsed(groupKey, !groupCollapsed)}
            >
              <span class="text-xs text-base-content/40 transition-transform {groupCollapsed ? '' : 'rotate-90'}">&rsaquo;</span>
              <span class="text-xs font-medium text-base-content/40">~/{getSkillSourcePath(group.source, 'user')}</span>
              <span class="text-xs text-base-content/30 ml-auto">{group.skills.length}</span>
            </button>
            {#if !groupCollapsed}
              <div id={groupPanelId('user', group.source)}>
              {#each group.skills as skill}
                {@render skillRow(skill)}
              {/each}
              </div>
            {/if}
          {/each}
          </div>
        {/if}
      {/if}
    {/if}
  </div>
</div>
