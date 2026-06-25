<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'
  import { skills, selectedSkillIdentity, activeProjectId } from './lib/stores'
  import { getHTMLElementAt, isInputFocused } from './lib/domUtils'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId?: string | null
  }

  let { api, context: _context, projectName, projectId = null }: Props = $props()
  import { useVimNavigation } from './lib/useVimNavigation.svelte'
  import ProjectPageHeader from './ProjectPageHeader.svelte'
  import MarkdownContent from '@openforge/plugin-sdk/ui/MarkdownContent.svelte'
  import { getPreferredSkillIdentity, getSkillIdentity, getSkillLocationLabel, getSkillSourcePath, getVisibleSkills, groupSkillsBySource, isSameSkillIdentity, parseSkillFrontmatter, stripSkillFrontmatter, type SkillInfo } from './lib/skillDomain'

  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let searchFilter = $state('')
  let editMode = $state(false)
  let editContent = $state('')
  let isSaving = $state(false)
  let saveError = $state<string | null>(null)
  let loadRequestId = 0
  let saveRequestId = 0
  let previousProjectId: string | null | undefined = undefined
  let pendingUserSkillSaveKeys = $state(new Set<string>())

  let selectedSkill = $derived($skills.find(s => isSameSkillIdentity(s, $selectedSkillIdentity)) || null)
  let selectedSkillSavePending = $derived(isSaving || hasPendingUserSkillSave(selectedSkill))
  let selectedSkillSourcePath = $derived(selectedSkill ? getSkillSourcePath(selectedSkill.source_dir, selectedSkill.level) : '')
  let selectedSkillFileLabel = $derived(selectedSkill?.relative_path || selectedSkill?.file_name || 'SKILL.md')
  let renderedSkillMarkdown = $derived(selectedSkill?.template ? stripSkillFrontmatter(selectedSkill.template) : '')
  let skillMarkdownHeadingId = $derived(selectedSkill ? `skill-markdown-${selectedSkill.level}-${selectedSkill.source_dir.replace(/[^a-zA-Z0-9_-]/g, '-')}-${selectedSkill.relative_path.replace(/[^a-zA-Z0-9_-]/g, '-')}` : 'skill-markdown-content')

  let filteredSkills = $derived(
    searchFilter.trim()
      ? $skills.filter(s =>
          s.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
          (s.description || '').toLowerCase().includes(searchFilter.toLowerCase())
        )
      : $skills
  )

  let projectSkills = $derived(filteredSkills.filter(s => s.level === 'project'))
  let userSkills = $derived(filteredSkills.filter(s => s.level === 'user'))

  let projectGroups = $derived(groupSkillsBySource(projectSkills))
  let userGroups = $derived(groupSkillsBySource(userSkills))

  // Collapsible state: track collapsed sections by key like "project" / "user" / "project:.agents"
  let collapsed = $state(new Map<string, boolean>())
  let visibleSkills = $derived(getVisibleSkills(filteredSkills, collapsed))

  const skillFilterId = 'skills-viewer-filter'

  function groupPanelId(level: SkillInfo['level'], source: string) {
    return `skills-${level}-${source.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  }

  function getUserSkillSaveKey(skill: SkillInfo): string | null {
    if (skill.level !== 'user') return null
    return JSON.stringify([skill.level, skill.source_dir, skill.relative_path])
  }

  function hasPendingUserSkillSave(skill: SkillInfo | null): boolean {
    if (!skill) return false
    const key = getUserSkillSaveKey(skill)
    return key ? pendingUserSkillSaveKeys.has(key) : false
  }

  function lockUserSkillSave(key: string | null) {
    if (!key) return
    pendingUserSkillSaveKeys = new Set(pendingUserSkillSaveKeys).add(key)
  }

  function unlockUserSkillSave(key: string | null) {
    if (!key) return
    const next = new Set(pendingUserSkillSaveKeys)
    next.delete(key)
    pendingUserSkillSaveKeys = next
  }

  // Auto-select a repository skill when the current selection is filtered out
  $effect(() => {
    if (!$activeProjectId) {
      if ($selectedSkillIdentity !== null) $selectedSkillIdentity = null
      return
    }

    if (filteredSkills.length === 0) {
      if ($skills.length === 0 && $selectedSkillIdentity !== null) $selectedSkillIdentity = null
      return
    }

    const preferredIdentity = getPreferredSkillIdentity(filteredSkills, $selectedSkillIdentity)
    const selectionIsVisible = filteredSkills.find(s => isSameSkillIdentity(s, $selectedSkillIdentity))
    if (preferredIdentity && !selectionIsVisible) {
      $selectedSkillIdentity = preferredIdentity
    }
  })

  function resetProjectState() {
    $skills = []
    $selectedSkillIdentity = null
    error = null
    saveError = null
    editMode = false
    editContent = ''
    searchFilter = ''
    isSaving = false
    saveRequestId += 1
  }

  async function loadSkills(projectIdToLoad = $activeProjectId) {
    if (!projectIdToLoad) {
      loadRequestId += 1
      isLoading = false
      resetProjectState()
      return
    }

    const requestId = ++loadRequestId
    isLoading = true
    error = null
    try {
      await api.backend.whenReady()
      const result = await api.backend.invoke<SkillInfo[]>('listSkills', { projectId: projectIdToLoad })
      if (requestId !== loadRequestId || projectIdToLoad !== $activeProjectId) return
      $skills = result
      // Auto-select a repository skill by default while preserving an existing valid selection
      $selectedSkillIdentity = getPreferredSkillIdentity(result, $selectedSkillIdentity)
    } catch (e) {
      if (requestId !== loadRequestId || projectIdToLoad !== $activeProjectId) return
      console.error('Failed to load skills:', e)
      error = 'Failed to load skills. Check the skills-viewer backend and project access.'
    } finally {
      if (requestId === loadRequestId && projectIdToLoad === $activeProjectId) {
        isLoading = false
      }
    }
  }

  function hasNameCollision(skill: SkillInfo) {
    return filteredSkills.some(candidate => candidate !== skill && candidate.name === skill.name)
  }

  function selectSkill(skill: SkillInfo) {
    void api.navigation.navigate({ viewId: 'plugin:com.openforge.skills-viewer:skills' })
    $selectedSkillIdentity = getSkillIdentity(skill)
    editMode = false
    saveError = null
  }

  function enterEditMode() {
    if (!selectedSkill) return
    editContent = selectedSkill.template || ''
    editMode = true
    saveError = null
  }

  function cancelEdit() {
    editMode = false
    saveError = null
  }

  async function saveEdit() {
    if (!selectedSkill || !$activeProjectId) return

    const projectIdToSave = $activeProjectId
    const skillToSave = selectedSkill
    const skillIdentity = getSkillIdentity(skillToSave)
    const contentToSave = editContent
    const userSkillSaveKey = getUserSkillSaveKey(skillToSave)
    const requestId = ++saveRequestId

    if (userSkillSaveKey && pendingUserSkillSaveKeys.has(userSkillSaveKey)) return

    lockUserSkillSave(userSkillSaveKey)
    isSaving = true
    saveError = null
    try {
      await api.backend.whenReady()
      await api.backend.invoke('saveSkillContent', {
        projectId: projectIdToSave,
        name: skillToSave.name,
        level: skillToSave.level,
        sourceDir: skillToSave.source_dir,
        sourcePath: skillToSave.source_path,
        content: contentToSave,
        fileName: skillToSave.file_name,
        relativePath: skillToSave.relative_path,
      })
      const shouldReflectSave = userSkillSaveKey
        ? isSameSkillIdentity(skillToSave, $selectedSkillIdentity)
        : requestId === saveRequestId && projectIdToSave === $activeProjectId
      if (!shouldReflectSave) return
      const savedFrontmatter = parseSkillFrontmatter(contentToSave)
      let savedSkillIdentity = skillIdentity

      // Update the local skill data with new content and freshly parsed metadata.
      $skills = $skills.map(s => {
        if (!isSameSkillIdentity(s, skillIdentity)) return s

        const savedSkill = {
          ...s,
          name: savedFrontmatter.name ?? s.name,
          description: savedFrontmatter.description,
          template: contentToSave,
        }
        savedSkillIdentity = getSkillIdentity(savedSkill)
        return savedSkill
      })
      if (isSameSkillIdentity(skillToSave, $selectedSkillIdentity)) {
        $selectedSkillIdentity = savedSkillIdentity
      }
      editMode = false
    } catch (e) {
      const shouldShowError = userSkillSaveKey
        ? isSameSkillIdentity(skillToSave, $selectedSkillIdentity)
        : requestId === saveRequestId && projectIdToSave === $activeProjectId && isSameSkillIdentity(skillToSave, $selectedSkillIdentity)
      if (!shouldShowError) return
      console.error('Failed to save skill:', e)
      saveError = String(e)
    } finally {
      unlockUserSkillSave(userSkillSaveKey)
      if (requestId === saveRequestId) {
        isSaving = false
      }
    }
  }

  const vimSkills = useVimNavigation({
    getItemCount: () => visibleSkills.length,
    onSelect: (index) => {
      const skill = visibleSkills[index]
      if (skill) selectSkill(skill)
    },
  })

  $effect(() => {
    // Clamp vim focus whenever filtering or collapsing changes the rendered rows.
    visibleSkills.length
    vimSkills.setFocusedIndex(vimSkills.focusedIndex)
  })

  function handleSkillsKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    vimSkills.handleKeydown(e)
  }

  // Scroll focused skill into view
  $effect(() => {
    const idx = vimSkills.focusedIndex
    const items = document.querySelectorAll('[data-vim-skill]')
    const el = getHTMLElementAt(items, idx)
    el?.scrollIntoView?.({ block: 'nearest' })
  })

  // Reload skills when active project changes (also handles initial load)
  $effect(() => {
    const currentProjectId = projectId
    if (currentProjectId === previousProjectId) return

    previousProjectId = currentProjectId
    $activeProjectId = currentProjectId
    loadRequestId += 1
    resetProjectState()

    if (currentProjectId) {
      void loadSkills(currentProjectId)
    } else {
      isLoading = false
    }
  })
</script>

<svelte:window onkeydown={handleSkillsKeydown} />

<div class="flex flex-col h-full overflow-hidden">
  <!-- Header -->
  <ProjectPageHeader
    title={projectName ? `${projectName} — Skills` : 'Skills'}
    subtitle={$activeProjectId ? 'View and edit project and personal skills' : 'Select a project to view skills'}
  >
    {#snippet actions()}
      <div class="flex items-center gap-2">
        <span class="badge badge-primary badge-sm">{$skills.length} {$skills.length === 1 ? 'skill' : 'skills'}</span>
        <button class="btn btn-sm border border-base-300" onclick={() => loadSkills()} disabled={isLoading || !$activeProjectId}>
          {isLoading ? '⟳' : '↻'} Refresh
        </button>
      </div>
    {/snippet}
  </ProjectPageHeader>

  <!-- Content -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Left panel: Skill list -->
    <div class="w-72 border-r border-base-300 flex flex-col shrink-0" style="background-color: var(--project-bg, oklch(var(--b1)))">
      <!-- Search -->
      <div class="p-3 border-b border-base-300">
        <label for={skillFilterId} class="sr-only">Filter skills</label>
        <input
          id={skillFilterId}
          type="text"
          placeholder="Filter skills..."
          class="input input-sm input-bordered w-full"
          bind:value={searchFilter}
        />
      </div>

      <!-- Skill list -->
      <div class="flex-1 overflow-y-auto">
        {#if !$activeProjectId}
          <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm text-center p-5">
            <span class="text-3xl">📁</span>
            <span class="font-medium text-base-content/70">Select a project</span>
            <span>Choose a project to view and edit its skills.</span>
          </div>
        {:else if isLoading && $skills.length === 0}
          <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm" role="status" aria-live="polite">
            <span class="loading loading-spinner loading-md text-primary"></span>
            <span>Loading skills...</span>
          </div>
        {:else if error}
          <div class="flex flex-col items-center justify-center h-full gap-3 text-error text-sm text-center p-5" role="alert">
            <span class="text-3xl">⚠</span>
            <span>{error}</span>
            <button class="btn btn-sm btn-outline" onclick={() => loadSkills()} disabled={isLoading}>Retry loading skills</button>
          </div>
        {:else if $skills.length === 0}
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
              onclick={() => { collapsed = new Map(collapsed).set('project', !levelCollapsed) }}
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
                  onclick={() => { collapsed = new Map(collapsed).set(groupKey, !groupCollapsed) }}
                >
                  <span class="text-xs text-base-content/40 transition-transform {groupCollapsed ? '' : 'rotate-90'}">&rsaquo;</span>
                  <span class="text-xs font-medium text-base-content/40">{getSkillSourcePath(group.source, 'project')}</span>
                  <span class="text-xs text-base-content/30 ml-auto">{group.skills.length}</span>
                </button>
                {#if !groupCollapsed}
                  <div id={groupPanelId('project', group.source)}>
                  {#each group.skills as skill}
                    {@const flatIdx = visibleSkills.indexOf(skill)}
                    {@const selected = isSameSkillIdentity(skill, $selectedSkillIdentity)}
                    <button
                      data-vim-skill
                      aria-current={selected ? 'true' : undefined}
                      class="w-full text-left pl-8 pr-3 py-2 border-b border-base-200 hover:bg-base-200 transition-colors cursor-pointer {selected ? 'bg-primary/10 border-l-2 border-l-primary' : ''} {flatIdx === vimSkills.focusedIndex ? 'vim-focus' : ''}"
                      onclick={() => selectSkill(skill)}
                    >
                      <span class="text-sm font-medium text-base-content truncate block">{skill.name}</span>
                      {#if hasNameCollision(skill)}
                        <p class="text-xs text-base-content/50 m-0 mt-0.5 line-clamp-1">{getSkillLocationLabel(skill)}</p>
                      {/if}
                      {#if skill.description}
                        <p class="text-xs text-base-content/50 m-0 mt-0.5 line-clamp-1">{skill.description}</p>
                      {/if}
                    </button>
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
              onclick={() => { collapsed = new Map(collapsed).set('user', !levelCollapsed) }}
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
                  onclick={() => { collapsed = new Map(collapsed).set(groupKey, !groupCollapsed) }}
                >
                  <span class="text-xs text-base-content/40 transition-transform {groupCollapsed ? '' : 'rotate-90'}">&rsaquo;</span>
                  <span class="text-xs font-medium text-base-content/40">~/{getSkillSourcePath(group.source, 'user')}</span>
                  <span class="text-xs text-base-content/30 ml-auto">{group.skills.length}</span>
                </button>
                {#if !groupCollapsed}
                  <div id={groupPanelId('user', group.source)}>
                  {#each group.skills as skill}
                    {@const flatIdx = visibleSkills.indexOf(skill)}
                    {@const selected = isSameSkillIdentity(skill, $selectedSkillIdentity)}
                    <button
                      data-vim-skill
                      aria-current={selected ? 'true' : undefined}
                      class="w-full text-left pl-8 pr-3 py-2 border-b border-base-200 hover:bg-base-200 transition-colors cursor-pointer {selected ? 'bg-primary/10 border-l-2 border-l-primary' : ''} {flatIdx === vimSkills.focusedIndex ? 'vim-focus' : ''}"
                      onclick={() => selectSkill(skill)}
                    >
                      <span class="text-sm font-medium text-base-content truncate block">{skill.name}</span>
                      {#if hasNameCollision(skill)}
                        <p class="text-xs text-base-content/50 m-0 mt-0.5 line-clamp-1">{getSkillLocationLabel(skill)}</p>
                      {/if}
                      {#if skill.description}
                        <p class="text-xs text-base-content/50 m-0 mt-0.5 line-clamp-1">{skill.description}</p>
                      {/if}
                    </button>
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

    <!-- Right panel: Skill detail -->
    <div class="flex-1 flex flex-col overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
      {#if $activeProjectId && selectedSkill}
        <!-- Skill detail header -->
        <div class="flex items-center justify-between px-6 py-3 border-b border-base-300 shrink-0" style="background-color: var(--project-bg-alt, oklch(var(--b2)))">
          <div class="flex items-center gap-3 min-w-0">
            <h3 class="text-base font-semibold text-base-content m-0 truncate">{selectedSkill.name}</h3>
            <span class="badge badge-sm {selectedSkill.level === 'project' ? 'badge-primary' : 'badge-secondary'} shrink-0">{selectedSkill.level === 'project' ? 'repository' : 'personal'}</span>
            <span class="text-xs text-base-content/40 shrink-0">{getSkillLocationLabel(selectedSkill)}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            {#if editMode}
              <button
                class="btn btn-ghost btn-sm text-base-content/70"
                onclick={cancelEdit}
                disabled={selectedSkillSavePending}
              >Cancel</button>
              <button
                class="btn btn-primary btn-sm"
                onclick={saveEdit}
                disabled={selectedSkillSavePending}
              >{selectedSkillSavePending ? 'Saving...' : 'Save'}</button>
            {:else}
              <button
                class="btn btn-ghost btn-sm text-base-content/70"
                onclick={enterEditMode}
                disabled={selectedSkillSavePending}
              >{selectedSkillSavePending ? 'Saving...' : 'Manually Edit'}</button>
            {/if}
          </div>
        </div>

        {#if saveError}
          <div class="px-6 py-2 bg-error/10 border-b border-error/20 shrink-0" role="alert">
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs text-error m-0">{saveError}</p>
              {#if editMode}
                <button class="btn btn-xs btn-error btn-outline" onclick={saveEdit} disabled={selectedSkillSavePending}>Retry saving skill</button>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Metadata -->
        {#if !editMode}
          <section class="px-6 py-3 border-b border-base-300 shrink-0" aria-label="Skill metadata">
            {#if selectedSkill.description}
              <p class="text-sm text-base-content/75 leading-relaxed m-0 mb-3">{selectedSkill.description}</p>
            {/if}
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt class="font-medium text-base-content/50">Scope</dt>
              <dd class="text-base-content/75 m-0">{selectedSkill.level === 'project' ? 'Repository' : 'Personal'}</dd>
              <dt class="font-medium text-base-content/50">Source</dt>
              <dd class="text-base-content/75 m-0 font-mono break-all">{selectedSkillSourcePath}</dd>
              <dt class="font-medium text-base-content/50">File</dt>
              <dd class="text-base-content/75 m-0 font-mono break-all">{selectedSkillFileLabel}</dd>
              {#if selectedSkill.agent}
                <dt class="font-medium text-base-content/50">Agent</dt>
                <dd class="text-base-content/75 m-0 font-mono break-all">{selectedSkill.agent}</dd>
              {/if}
            </dl>
          </section>
        {/if}

        {#if editMode}
          <!-- Edit mode: raw markdown textarea -->
          <div class="flex-1 overflow-hidden flex flex-col">
            <textarea
              class="flex-1 w-full p-4 font-mono text-sm text-base-content resize-none border-none outline-none"
              style="background-color: var(--project-bg, oklch(var(--b1)))"
              bind:value={editContent}
              spellcheck="false"
            ></textarea>
          </div>
        {:else}
          <!-- Read mode: rendered markdown -->
          <div class="flex-1 overflow-y-auto px-6 py-4" role="region" aria-labelledby={skillMarkdownHeadingId}>
            {#if selectedSkill.template}
              <article
                class="max-w-3xl text-base-content leading-relaxed [&_.markdown-body]:text-sm [&_.markdown-body]:leading-relaxed [&_.markdown-body_a]:rounded-sm [&_.markdown-body_a]:focus-visible:outline-none [&_.markdown-body_a]:focus-visible:ring-2 [&_.markdown-body_a]:focus-visible:ring-primary [&_.markdown-body_a]:focus-visible:ring-offset-2 [&_.markdown-body_a]:focus-visible:ring-offset-base-100"
                aria-labelledby={skillMarkdownHeadingId}
              >
                <h4 id={skillMarkdownHeadingId} class="sr-only">{selectedSkill.name} skill markdown</h4>
                <MarkdownContent content={renderedSkillMarkdown} onOpenUrl={(url) => api.system.openUrl(url)} />
              </article>
            {:else}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-center">
                <span class="text-3xl">📄</span>
                <p class="text-sm m-0">No content available for this skill.</p>
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        <!-- No skill selected -->
        <div class="flex flex-col items-center justify-center h-full gap-4 text-base-content/50 text-center">
          {#if !$activeProjectId}
            <span class="text-5xl">📁</span>
            <h3 class="text-lg font-semibold text-base-content/70 m-0">Select a project</h3>
            <p class="text-sm m-0">Choose a project to view and edit its skills.</p>
          {:else if $skills.length > 0}
            <span class="text-5xl">👈</span>
            <h3 class="text-lg font-semibold text-base-content/70 m-0">Select a skill</h3>
            <p class="text-sm m-0">Choose a skill from the list to view its content.</p>
          {:else if !isLoading && !error}
            <span class="text-5xl">📝</span>
            <h3 class="text-lg font-semibold text-base-content/70 m-0">No skills yet</h3>
            <p class="text-sm m-0">Add skills to your project or personal directories to see them here.</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
