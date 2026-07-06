<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
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
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
  import SkillDetailSection from './SkillDetailSection.svelte'
  import SkillsListSection from './SkillsListSection.svelte'
  import { getPreferredSkillIdentity, getSkillIdentity, getSkillSourcePath, getVisibleSkills, groupSkillsBySource, isSameSkillIdentity, parseSkillFrontmatter, stripSkillFrontmatter, type SkillInfo } from './lib/skillDomain'

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
  <PluginPageHeader
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
  </PluginPageHeader>

  <div class="flex flex-1 overflow-hidden">
    <SkillsListSection
      activeProjectId={$activeProjectId}
      {isLoading}
      {error}
      skillsCount={$skills.length}
      {filteredSkills}
      {projectSkills}
      {userSkills}
      {projectGroups}
      {userGroups}
      {visibleSkills}
      selectedSkillIdentity={$selectedSkillIdentity}
      {collapsed}
      focusedIndex={vimSkills.focusedIndex}
      {skillFilterId}
      {searchFilter}
      onSearchFilterChange={(value) => { searchFilter = value }}
      onRetryLoad={() => { void loadSkills() }}
      onSelectSkill={selectSkill}
      onToggleCollapsed={(key, value) => { collapsed = new Map(collapsed).set(key, value) }}
      {hasNameCollision}
      {groupPanelId}
    />

    <SkillDetailSection
      activeProjectId={$activeProjectId}
      skillsCount={$skills.length}
      {isLoading}
      {error}
      {selectedSkill}
      {selectedSkillSavePending}
      {selectedSkillSourcePath}
      {selectedSkillFileLabel}
      {renderedSkillMarkdown}
      {skillMarkdownHeadingId}
      {editMode}
      {editContent}
      {saveError}
      onCancelEdit={cancelEdit}
      onSaveEdit={() => { void saveEdit() }}
      onEnterEditMode={enterEditMode}
      onEditContentChange={(content) => { editContent = content }}
      onOpenUrl={(url) => api.system.openUrl(url)}
    />
  </div>
</div>
