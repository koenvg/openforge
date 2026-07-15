<script lang="ts">
  import { tick } from 'svelte'
  import Modal from '../shared/ui/Modal.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import MarkdownContent from '../shared/adapters/MarkdownContent.svelte'
  import { useInjectableCatalog } from '../../lib/injectables/useInjectableCatalog.svelte'
  import {
    searchInjectables,
    filterInjectables,
    groupInjectables,
    cycleSectionFilter,
    ORIGIN_LABELS,
    ORIGIN_DESCRIPTIONS,
    TRIGGER_LABELS,
    SNIPPET_SECTION_LABEL,
    SECTION_ORDER,
    formatCharCount,
    stepSelection,
    isEditablePersonalSkill,
    isEditableSnippet,
    snippetDbId,
    findInjectableBySource,
    isProjectChecked,
    toggleAllProjectsScope,
    toggleProjectInScope,
    flattenNavRows,
    navLeft,
    navRight,
    groupRowId,
    type TreeKeyResult,
  } from '@openforge-app/plugin-sdk/injectables'
  import { writePersonalSkill, deletePersonalSkill, getProjects } from '../../lib/ipc'
  import { createSnippet, updateSnippet, deleteSnippet } from '../../lib/injectables/pluginSnippetStore'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import SquareTerminal from '@lucide/svelte/icons/square-terminal'
  import NotebookText from '@lucide/svelte/icons/notebook-text'
  import Plus from '@lucide/svelte/icons/plus'
  import type {
    Injectable,
    InjectableGroupBy,
    InjectableOrigin,
    InjectableSection,
    InjectableTriggerMode,
    Project,
  } from '../../lib/types'

  // Per-origin / per-trigger accent colours (daisyUI semantic tokens — no hex).
  const ORIGIN_BADGE: Record<InjectableOrigin, string> = {
    personal: 'badge-primary',
    project: 'badge-secondary',
    plugin: 'badge-accent',
    builtin: 'badge-neutral',
  }
  // Trigger shown as emoji instead of a chip: ⚡ = auto (model-invokable), ✋ = manual
  // (user-invokable). The full label rides along as a tooltip.
  const TRIGGER_EMOJI: Record<InjectableTriggerMode, string> = {
    'auto+manual': '⚡✋',
    'manual-only': '✋',
  }
  const SNIPPET_BADGE = 'badge-info'

  function sectionLabel(key: string): string {
    return key === 'snippet' ? SNIPPET_SECTION_LABEL : ORIGIN_LABELS[key as InjectableOrigin]
  }
  function groupBadge(key: string): string {
    if (key === 'snippet') return SNIPPET_BADGE
    return groupBy === 'origin' ? ORIGIN_BADGE[key as InjectableOrigin] : 'badge-ghost'
  }
  function groupDescription(key: string): string {
    return key === 'snippet'
      ? 'Saved text you reuse — stored by OpenForge'
      : (ORIGIN_DESCRIPTIONS[key as InjectableOrigin] ?? '')
  }

  interface Props {
    projectId: string | null
    open: boolean
    onClose: () => void
    onSelect: (injectable: Injectable) => void
  }
  let { projectId, open, onClose, onSelect }: Props = $props()

  const catalog = useInjectableCatalog(() => projectId)

  let query = $state('')
  let groupBy = $state<InjectableGroupBy>('origin')
  let selectedSections = $state<Set<InjectableSection>>(new Set())
  let selectedId = $state<string | null>(null)
  let detailOpen = $state(false)
  let contentView = $state<'md' | 'raw'>('md')
  // Row descriptions wrap by default; toggled off (single line + ellipsis) via the
  // header button or the `W` shortcut.
  let wrapDescriptions = $state(true)
  let collapsed = $state<Set<string>>(new Set())
  let listEl = $state<HTMLElement | null>(null)
  let detailEl = $state<HTMLElement | null>(null)
  let searchInputEl = $state<HTMLInputElement | null>(null)

  // Inline authoring (personal skills + snippets).
  let editing = $state(false)
  let creating = $state(false)
  let editName = $state('')
  let editDraft = $state('')
  let projects = $state<Project[]>([])
  // Per-snippet project scope is set from an always-visible header dropdown that
  // auto-saves; `scopeMenuOpen` toggles it, `scopeBusy` guards in-flight saves.
  let scopeBusy = $state(false)
  let scopeMenuOpen = $state(false)
  let confirmingDelete = $state(false)
  let busy = $state(false)
  let actionError = $state<string | null>(null)

  let prevOpen = false
  $effect(() => {
    if (open && !prevOpen) {
      void catalog.reload()
      void loadProjects()
      // Each summon starts fresh: nothing selected, preview closed, rendered (md) view.
      selectedId = null
      detailOpen = false
      contentView = 'md'
      wrapDescriptions = true
      editing = false
      creating = false
      confirmingDelete = false
      actionError = null
    }
    prevOpen = open
  })

  const visible = $derived(
    filterInjectables(searchInjectables(catalog.injectables, query), {
      sections: [...selectedSections],
    }),
  )
  const groups = $derived(groupInjectables(visible, groupBy))
  const snippetAllowed = $derived(selectedSections.size === 0 || selectedSections.has('snippet'))
  // Keep the Snippets section visible (with its create affordance) even when the user has
  // none yet — but not while a search is narrowing the list.
  const displayGroups = $derived.by(() => {
    if (groups.some((g) => g.key === 'snippet')) return groups
    if (snippetAllowed && !query.trim()) {
      return [{ key: 'snippet', label: SNIPPET_SECTION_LABEL, items: [] as Injectable[] }, ...groups]
    }
    return groups
  })
  // Keyboard rows in display order: a header per group, then its items when expanded.
  // ↑/↓ step through all rows (headers + items); ←/→ collapse/expand groups.
  const navRows = $derived(flattenNavRows(displayGroups, collapsed))
  const navigableIds = $derived(navRows.map((r) => r.id))
  // The previewed item — a group-header row (`group:…`) resolves to null (no preview).
  const selected = $derived(
    selectedId === null ? null : (visible.find((i) => i.id === selectedId) ?? null),
  )
  const canEdit = $derived(
    selected !== null && (isEditablePersonalSkill(selected) || isEditableSnippet(selected)),
  )
  // The name+body editor is shown for a new snippet or an existing snippet edit.
  const editingSnippet = $derived(creating || (editing && selected?.kind === 'snippet'))
  const saveDisabled = $derived(
    busy || (editingSnippet && (editName.trim() === '' || editDraft.trim() === '')),
  )
  // A selected snippet's persisted project scope (from the raw catalog list), driving the
  // always-visible "Available in" dropdown, which auto-saves on toggle.
  const selectedSnippetScope = $derived.by(() => {
    if (!selected || selected.kind !== 'snippet') return null
    const raw = catalog.snippets.find((s) => s.id === snippetDbId(selected))
    return raw
      ? { allProjects: raw.allProjects, projectIds: raw.projectIds }
      : { allProjects: true, projectIds: [] as string[] }
  })

  // Keep the highlighted row on screen while navigating with the keyboard.
  $effect(() => {
    const id = selectedId
    if (!id || !listEl) return
    try {
      listEl.querySelector(`[data-injectable-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
    } catch {
      /* jsdom / unsupported */
    }
  })

  // Leave edit/confirm/error state behind whenever the selection changes.
  let prevSelectedForEdit: string | null = null
  $effect(() => {
    const id = selectedId
    if (id !== prevSelectedForEdit) {
      prevSelectedForEdit = id
      editing = false
      confirmingDelete = false
      scopeMenuOpen = false
      actionError = null
    }
  })

  function toggleSection(s: InjectableSection) {
    const next = new Set(selectedSections)
    if (next.has(s)) next.delete(s)
    else next.add(s)
    selectedSections = next
  }

  async function loadProjects() {
    try {
      projects = await getProjects()
    } catch {
      projects = []
    }
  }

  function scopeLabel(scope: { allProjects: boolean; projectIds: string[] }): string {
    if (scope.allProjects) return 'All projects'
    if (scope.projectIds.length === 0) return 'No projects'
    if (scope.projectIds.length === 1) {
      return projects.find((p) => p.id === scope.projectIds[0])?.name ?? '1 project'
    }
    return `${scope.projectIds.length} projects`
  }

  // Auto-save a snippet's project scope (title/content preserved from the raw row).
  async function persistScope(id: string, next: { allProjects: boolean; projectIds: string[] }) {
    const raw = catalog.snippets.find((s) => s.id === id)
    if (!raw) return
    scopeBusy = true
    actionError = null
    try {
      await updateSnippet(id, raw.name, raw.body, next.allProjects, $state.snapshot(next.projectIds))
      await catalog.reload()
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e)
    } finally {
      scopeBusy = false
    }
  }

  function onScopeToggleAll() {
    const id = selected ? snippetDbId(selected) : null
    if (!id || !selectedSnippetScope) return
    void persistScope(id, toggleAllProjectsScope(selectedSnippetScope))
  }

  function onScopeToggleProject(projectId: string) {
    const id = selected ? snippetDbId(selected) : null
    if (!id || !selectedSnippetScope) return
    void persistScope(id, toggleProjectInScope(selectedSnippetScope, projectId, projects.map((p) => p.id)))
  }

  function toggleCollapse(key: string) {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    collapsed = next
  }

  // Click a row to preview it; click the already-open row again to close the preview.
  function onRowClick(id: string) {
    if (detailOpen && selectedId === id && !creating) {
      closeDetail()
    } else {
      creating = false
      selectedId = id
      detailOpen = true
    }
  }

  function closeDetail() {
    detailOpen = false
    selectedId = null
    creating = false
    scopeMenuOpen = false
  }

  function insert(injectable: Injectable | null) {
    if (!injectable) return
    onSelect(injectable)
    onClose()
  }

  function startCreate() {
    selectedId = null
    editing = false
    editName = ''
    editDraft = ''
    actionError = null
    creating = true
    detailOpen = true
  }

  function startEdit() {
    if (!selected) return
    // Edit only changes the title + content; project scope is managed by the header dropdown.
    editName = selected.kind === 'snippet' ? selected.name : ''
    editDraft = selected.content ?? ''
    actionError = null
    editing = true
  }

  function cancelEditor() {
    if (creating) {
      closeDetail()
    } else {
      editing = false
    }
    actionError = null
  }

  async function saveEditor() {
    if (creating) return saveCreate()
    if (!selected) return
    if (selected.kind === 'snippet') return saveSnippetEdit(selected)
    return saveSkillEdit(selected)
  }

  async function saveCreate() {
    busy = true
    actionError = null
    try {
      // New snippets default to "All projects"; scope is narrowed afterward via the dropdown.
      const created = await createSnippet(editName, editDraft, true, [])
      await catalog.reload()
      creating = false
      selectedId = `snippet:${created.id}`
      detailOpen = true
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function saveSnippetEdit(sel: Injectable) {
    const id = snippetDbId(sel)
    if (!id) return
    // Preserve the snippet's current project scope; Edit only changes title + content.
    const raw = catalog.snippets.find((s) => s.id === id)
    busy = true
    actionError = null
    try {
      await updateSnippet(
        id,
        editName,
        editDraft,
        raw?.allProjects ?? true,
        raw ? $state.snapshot(raw.projectIds) : [],
      )
      await catalog.reload()
      // The injectable id (`snippet:${dbId}`) is stable across a rename, so the
      // selection stays put with no re-resolution needed.
      editing = false
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function saveSkillEdit(sel: Injectable) {
    if (!sel.sourceDir || !sel.sourcePath) return
    const { sourceDir, sourcePath } = sel
    busy = true
    actionError = null
    try {
      await writePersonalSkill(sourceDir, sourcePath, editDraft)
      await catalog.reload()
      // An edit can change the frontmatter `name`, which changes the injectable id; keep the
      // selection on the same on-disk skill by re-resolving via its unchanged folder identity.
      selectedId = findInjectableBySource(catalog.injectables, sourceDir, sourcePath)?.id ?? null
      editing = false
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  function requestDelete() {
    actionError = null
    confirmingDelete = true
  }

  function cancelDelete() {
    confirmingDelete = false
    actionError = null
  }

  async function confirmDelete() {
    if (!selected) return
    const sel = selected
    let performDelete: () => Promise<void>
    if (sel.kind === 'snippet') {
      const id = snippetDbId(sel)
      if (!id) return
      performDelete = () => deleteSnippet(id)
    } else {
      if (!sel.sourceDir || !sel.sourcePath) return
      const { sourceDir, sourcePath } = sel
      performDelete = () => deletePersonalSkill(sourceDir, sourcePath)
    }
    busy = true
    actionError = null
    try {
      await performDelete()
      await catalog.reload()
      confirmingDelete = false
      closeDetail()
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  // Wired into Modal's onKeydown: return true to signal "handled" so the modal skips its
  // own default handling. Up/down move the selection (and open the preview); Enter inserts.
  // While editing/creating, keys belong to the editor (Escape cancels it).
  function focusRow(id: string | null) {
    if (!id || !listEl) return
    listEl.querySelector<HTMLElement>(`[data-injectable-id="${id}"]`)?.focus()
  }

  // Apply an ArrowLeft/ArrowRight tree action: collapse/expand a group and/or move the
  // keyboard cursor, then focus the resulting row once the DOM settles.
  function applyTreeResult(r: TreeKeyResult) {
    if (r.type === 'none') return
    if (r.type === 'toggle') toggleCollapse(r.groupKey)
    selectedId = r.focusId
    void tick().then(() => focusRow(selectedId))
  }

  function pickerKeydown(e: KeyboardEvent): boolean | void {
    // ⌘1 / ⌘2 cycle the single-select filter cursor left/right (circular), overwriting
    // any multi-selection. Works regardless of edit state. If the list currently holds
    // focus, keep it there (re-focus the first row when the active one is filtered out).
    if (e.metaKey && (e.key === '1' || e.key === '2')) {
      e.preventDefault()
      const listHadFocus = !!(
        listEl && document.activeElement && listEl.contains(document.activeElement)
      )
      selectedSections = new Set(cycleSectionFilter([...selectedSections], e.key === '2' ? 1 : -1))
      if (listHadFocus) {
        void tick().then(() => {
          if (!selectedId || !navigableIds.includes(selectedId)) selectedId = navigableIds[0] ?? null
          focusRow(selectedId)
        })
      }
      return true
    }
    if (editing || creating) {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelEditor()
        return true
      }
      return
    }
    // `W` toggles description wrap — but not while typing in the search box.
    if ((e.key === 'w' || e.key === 'W') && !e.metaKey && !e.ctrlKey && !e.altKey && e.target !== searchInputEl) {
      e.preventDefault()
      wrapDescriptions = !wrapDescriptions
      return true
    }
    // One Tab from the search input jumps straight into the list — the filter/group
    // controls are tabindex=-1 (driven by ⌘1/⌘2 + mouse), so the list is one Tab away.
    if (e.key === 'Tab' && !e.shiftKey && e.target === searchInputEl && navigableIds.length > 0) {
      e.preventDefault()
      selectedId = navigableIds[0]
      focusRow(selectedId)
      return true
    }
    // Tab from a list row moves focus into the detail panel; Shift+Tab returns to the row.
    const activeEl = document.activeElement
    if (
      e.key === 'Tab' &&
      !e.shiftKey &&
      detailEl &&
      listEl &&
      activeEl &&
      listEl.contains(activeEl)
    ) {
      e.preventDefault()
      const target = detailEl.querySelector<HTMLElement>(
        'button:not([tabindex="-1"]), [tabindex="0"], input, textarea, [href]',
      )
      ;(target ?? detailEl).focus()
      return true
    }
    if (
      e.key === 'Tab' &&
      e.shiftKey &&
      detailEl &&
      activeEl &&
      detailEl.contains(activeEl)
    ) {
      e.preventDefault()
      focusRow(selectedId)
      return true
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (navigableIds.length === 0) return
      e.preventDefault()
      selectedId = stepSelection(navigableIds, selectedId, e.key === 'ArrowDown' ? 1 : -1)
      // Navigation keeps the list at full width (descriptions stay readable); Space toggles
      // the detail pane. Re-focus the row after any pending DOM settle.
      void tick().then(() => focusRow(selectedId))
      return true
    }
    // Space toggles the detail (main content) pane for the current row, without
    // squeezing the list during navigation. Only when a list row holds focus.
    if ((e.key === ' ' || e.code === 'Space') && listEl && activeEl && listEl.contains(activeEl)) {
      e.preventDefault()
      detailOpen = !detailOpen
      void tick().then(() => focusRow(selectedId))
      return true
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      applyTreeResult(navRight(navRows, selectedId, collapsed))
      return true
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      applyTreeResult(navLeft(navRows, selectedId, collapsed))
      return true
    }
    if (e.key === 'Enter') {
      // On a group header, Enter toggles collapse; on an item, it inserts.
      if (selectedId?.startsWith('group:')) {
        e.preventDefault()
        toggleCollapse(selectedId.slice('group:'.length))
        return true
      }
      if (selected) {
        e.preventDefault()
        insert(selected)
        return true
      }
    }
  }
</script>

{#snippet nameBodyEditor()}
  <input
    data-testid="snippet-name"
    class="input input-bordered input-sm w-full"
    placeholder="Snippet name"
    bind:value={editName}
    autocomplete="off" />
  <textarea
    data-testid="snippet-editor"
    class="textarea textarea-bordered mt-3 min-h-80 w-full flex-1 font-mono text-xs leading-relaxed"
    placeholder="Snippet text — inserted verbatim when picked"
    bind:value={editDraft}
    spellcheck="false"></textarea>
{/snippet}

{#snippet scopeMenu(scope: { allProjects: boolean; projectIds: string[] })}
  <div class="relative">
    <button
      tabindex="-1"
      class="btn btn-xs btn-ghost gap-1"
      data-testid="scope-menu-trigger"
      onclick={() => (scopeMenuOpen = !scopeMenuOpen)}
      type="button"
      aria-haspopup="true"
      aria-expanded={scopeMenuOpen}>
      {scopeLabel(scope)}<span class="opacity-50">▾</span>
    </button>
    {#if scopeMenuOpen}
      <button
        class="fixed inset-0 z-10 cursor-default"
        tabindex="-1"
        aria-label="Close projects menu"
        onclick={() => (scopeMenuOpen = false)}></button>
      <div class="absolute right-0 z-20 mt-1 w-60 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
        <div class="px-1 pb-1 text-xs font-medium uppercase tracking-wide opacity-45">Available in</div>
        <label class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-base-200">
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            data-testid="scope-all"
            checked={scope.allProjects}
            disabled={scopeBusy}
            onchange={onScopeToggleAll} />
          <span>All projects</span>
        </label>
        {#each projects as p (p.id)}
          <label class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 pl-4 text-sm hover:bg-base-200">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              data-testid="scope-project-{p.id}"
              checked={isProjectChecked(scope, p.id)}
              disabled={scopeBusy}
              onchange={() => onScopeToggleProject(p.id)} />
            <span class="truncate">{p.name}</span>
          </label>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet listBody()}
  {#if catalog.error}
    <p class="p-4 text-sm text-error">{catalog.error}</p>
  {/if}
  {#each displayGroups as group (group.key)}
    <!-- Generous space between groups, tight within — the tight/generous beat. -->
    <section class="mt-4 first:mt-0">
      <div class="flex w-full items-center gap-2 px-2 py-1.5">
        <button
          data-injectable-id={groupRowId(group.key)}
          class="flex flex-1 items-center gap-2 rounded text-left"
          class:ring-2={selectedId === groupRowId(group.key)}
          class:ring-primary={selectedId === groupRowId(group.key)}
          class:bg-base-200={selectedId === groupRowId(group.key)}
          tabindex={selectedId === groupRowId(group.key) ? 0 : -1}
          onclick={() => toggleCollapse(group.key)}
          type="button">
          <span class="w-4 shrink-0 text-center text-xs opacity-50">{collapsed.has(group.key) ? '▸' : '▾'}</span>
          <span class="text-xs font-bold uppercase tracking-wider">{group.label}</span>
          <span class="badge badge-xs {groupBadge(group.key)}">{group.items.length}</span>
          {#if groupBy === 'origin' || group.key === 'snippet'}
            <span class="ml-1 truncate text-xs opacity-45">{groupDescription(group.key)}</span>
          {/if}
        </button>
        {#if group.key === 'snippet'}
          <button class="btn btn-xs btn-ghost gap-1" tabindex={-1} onclick={startCreate} type="button">
            <Plus size={12} /><span>New snippet</span>
          </button>
        {/if}
      </div>
      {#if !collapsed.has(group.key)}
        {#if group.key === 'snippet' && group.items.length === 0}
          <p class="py-2 pl-8 pr-2 text-xs opacity-50">No snippets yet — create one to reuse text.</p>
        {:else}
          <div class="mt-0.5 flex flex-col">
            {#each group.items as item (item.id)}
              <button
                data-injectable-id={item.id}
                class="flex w-full flex-col gap-0.5 rounded-md py-2 pl-8 pr-2 text-left hover:bg-base-200"
                class:ring-2={selectedId === item.id}
                class:ring-primary={selectedId === item.id}
                class:bg-base-200={selectedId === item.id}
                tabindex={selectedId === item.id ? 0 : -1}
                onclick={() => onRowClick(item.id)}
                ondblclick={() => insert(item)}
                type="button">
                <span class="flex items-center gap-2">
                  {#if item.kind === 'snippet'}
                    <NotebookText size={14} class="shrink-0 text-info" />
                  {:else if item.kind === 'skill'}
                    <Sparkles size={14} class="shrink-0 text-primary/80" />
                  {:else}
                    <SquareTerminal size={14} class="shrink-0 opacity-60" />
                  {/if}
                  <span class="text-sm font-semibold">
                    {#if item.kind !== 'snippet'}<span class="opacity-40">/</span>{/if}{item.name}
                  </span>
                  {#if item.kind !== 'snippet'}
                    <span class="shrink-0 text-xs leading-none" title={TRIGGER_LABELS[item.triggerMode]}>{TRIGGER_EMOJI[item.triggerMode]}</span>
                  {/if}
                  {#if item.content}
                    <span class="ml-auto shrink-0 pl-2 text-xs tabular-nums opacity-45">{formatCharCount(item.content.length)}</span>
                  {/if}
                </span>
                {#if item.description}
                  <span class="pl-6 pr-1 text-xs leading-snug opacity-60 {wrapDescriptions ? '' : 'truncate'}">{item.description}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </section>
  {/each}
  {#if displayGroups.length === 0 && query.trim()}
    <div class="p-6 text-center text-sm opacity-70">No injectables match “{query}”.</div>
  {/if}
  {#if projectId == null}
    <p class="px-3 py-3 text-center text-xs opacity-50">
      Pick an agent for this task to load its skills &amp; commands. Snippets are always available.
    </p>
  {/if}
{/snippet}

{#if open}
  <Modal
    {onClose}
    onKeydown={pickerKeydown}
    ariaLabel="Injectable picker"
    maxWidth="90vw"
    boxClass="w-[90vw] h-[85vh]"
    initialFocus="input">
    {#snippet header()}
      <div class="flex items-center gap-3">
        <h2 class="text-base font-semibold">Injectables</h2>
        <span class="text-xs opacity-60">Browse, read &amp; insert skills, commands &amp; snippets</span>
      </div>
    {/snippet}

    <!-- Search + controls: one padded band, generous around it, tight (gap-3) inside -->
    <div class="flex flex-col gap-3 px-5 pt-4 pb-4">
      <input
        bind:this={searchInputEl}
        class="input input-bordered w-full"
        placeholder="Search injectables…"
        bind:value={query}
        autocomplete="off"
      />
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-medium uppercase tracking-wide opacity-45">Filter</span>
          <div class="flex flex-wrap items-center gap-1">
            <button
              data-testid="filter-chip-all"
              class="btn btn-xs btn-ghost rounded-full"
              class:btn-active={selectedSections.size === 0}
              tabindex={-1}
              onclick={() => (selectedSections = new Set())}
              type="button">All</button>
            {#each SECTION_ORDER as s (s)}
              <button
                data-testid="filter-chip-{s}"
                class="btn btn-xs btn-ghost rounded-full"
                class:btn-active={selectedSections.has(s)}
                tabindex={-1}
                onclick={() => toggleSection(s)}
                type="button">{sectionLabel(s)}</button>
            {/each}
          </div>
        </div>
        <span class="h-4 w-px bg-base-300"></span>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-medium uppercase tracking-wide opacity-45">Group</span>
          <div class="join">
            <button
              class="btn btn-xs join-item"
              class:btn-active={groupBy === 'origin'}
              tabindex={-1}
              onclick={() => (groupBy = 'origin')}
              type="button">Origin</button>
            <button
              class="btn btn-xs join-item"
              class:btn-active={groupBy === 'trigger'}
              tabindex={-1}
              onclick={() => (groupBy = 'trigger')}
              type="button">Trigger</button>
          </div>
        </div>
        <span class="h-4 w-px bg-base-300"></span>
        <button
          class="btn btn-xs"
          class:btn-active={!wrapDescriptions}
          tabindex={-1}
          aria-pressed={!wrapDescriptions}
          title="Toggle description wrap (W)"
          onclick={() => (wrapDescriptions = !wrapDescriptions)}
          type="button">{wrapDescriptions ? 'Wrap' : 'No wrap'}</button>
      </div>
    </div>

    <!-- Body: list + detail -->
    <div class="flex min-h-0 flex-1 border-t border-base-300">
      {#if detailOpen}
        <!-- Draggable divider between the list and the preview. -->
        <ResizablePanel
          storageKey="injectable-picker-list"
          defaultWidth={420}
          minWidth={280}
          maxWidth={720}
          side="left">
          <div bind:this={listEl} class="h-full overflow-y-auto p-2">
            {@render listBody()}
          </div>
        </ResizablePanel>

        <div bind:this={detailEl} tabindex="-1" class="flex min-w-0 flex-1 flex-col border-l border-base-300">
          {#if selected}
            <!-- Detail header: identity (left, primary) + actions (right) -->
            <div class="flex items-start justify-between gap-4 border-b border-base-300 px-5 py-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  {#if selected.kind === 'snippet'}
                    <NotebookText size={18} class="shrink-0 text-info" />
                  {:else if selected.kind === 'skill'}
                    <Sparkles size={18} class="shrink-0 text-primary/80" />
                  {:else}
                    <SquareTerminal size={18} class="shrink-0 opacity-60" />
                  {/if}
                  <h3 class="truncate text-lg font-bold leading-tight">
                    {#if selected.kind !== 'snippet'}<span class="opacity-40">/</span>{/if}{selected.name}
                  </h3>
                </div>
                <div class="mt-1.5 flex flex-wrap items-center gap-2 pl-7">
                  {#if selected.kind === 'snippet'}
                    <span class="badge badge-sm {SNIPPET_BADGE}">Snippet</span>
                  {:else}
                    <span class="badge badge-sm badge-outline {ORIGIN_BADGE[selected.origin]}">{ORIGIN_LABELS[selected.origin]}</span>
                    <span class="text-sm leading-none" title={TRIGGER_LABELS[selected.triggerMode]}>{TRIGGER_EMOJI[selected.triggerMode]}</span>
                  {/if}
                  {#if selected.content}
                    <span class="text-xs tabular-nums opacity-50">{formatCharCount(selected.content.length)}</span>
                  {/if}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                {#if editing}
                  <span class="text-xs opacity-60">Editing</span>
                {:else}
                  {#if selected.kind === 'snippet' && selectedSnippetScope}
                    {@render scopeMenu(selectedSnippetScope)}
                  {/if}
                  {#if canEdit}
                    <button class="btn btn-xs btn-ghost" onclick={startEdit} type="button">Edit</button>
                    <button class="btn btn-xs btn-ghost text-error" onclick={requestDelete} type="button">Delete</button>
                  {/if}
                  {#if selected.content}
                    <div class="join">
                      <button
                        class="btn btn-xs join-item"
                        class:btn-active={contentView === 'md'}
                        aria-pressed={contentView === 'md'}
                        onclick={() => (contentView = 'md')}
                        type="button">Rendered</button>
                      <button
                        class="btn btn-xs join-item"
                        class:btn-active={contentView === 'raw'}
                        aria-pressed={contentView === 'raw'}
                        onclick={() => (contentView = 'raw')}
                        type="button">Raw</button>
                    </div>
                  {/if}
                {/if}
                <button
                  class="btn btn-ghost btn-xs btn-circle"
                  aria-label="Close preview"
                  onclick={closeDetail}
                  type="button">✕</button>
              </div>
            </div>

            <!-- Detail body -->
            <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
              {#if actionError}
                <p class="mb-3 text-sm text-error">{actionError}</p>
              {/if}
              {#if editing}
                {#if selected.kind === 'snippet'}
                  {@render nameBodyEditor()}
                {:else}
                  <textarea
                    data-testid="skill-editor"
                    class="textarea textarea-bordered min-h-80 w-full flex-1 font-mono text-xs leading-relaxed"
                    bind:value={editDraft}
                    spellcheck="false"></textarea>
                {/if}
              {:else}
                {#if selected.description}
                  <p class="text-sm leading-relaxed">{selected.description}</p>
                {/if}
                {#if selected.sourcePath}
                  <p class="mt-2 text-xs opacity-50">Source: <code>{selected.sourcePath}</code></p>
                {/if}
                {#if selected.content}
                  {#if contentView === 'md'}
                    <div data-testid="injectable-content-md" class="mt-5">
                      <MarkdownContent content={selected.content} />
                    </div>
                  {:else}
                    <pre
                      data-testid="injectable-content-raw"
                      class="mt-5 overflow-x-auto whitespace-pre-wrap rounded-lg bg-base-200 p-4 text-xs leading-relaxed">{selected.content}</pre>
                  {/if}
                {:else}
                  <p class="mt-5 text-sm opacity-70">
                    Provided by Claude Code — no source file to read. Insert it with its command.
                  </p>
                {/if}
              {/if}
            </div>

            <!-- Detail footer -->
            <div class="flex items-center gap-3 border-t border-base-300 px-5 py-3">
              {#if editing}
                <button class="btn btn-primary btn-sm" disabled={saveDisabled} onclick={saveEditor} type="button">
                  Save
                </button>
                <button class="btn btn-ghost btn-sm" disabled={busy} onclick={cancelEditor} type="button">
                  Cancel
                </button>
                {#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
              {:else}
                <button class="btn btn-primary btn-sm" onclick={() => insert(selected)} type="button">
                  Insert into prompt
                </button>
                {#if selected.kind === 'snippet'}
                  <span class="text-xs opacity-60">Inserts the snippet text — you review before sending</span>
                {:else}
                  <span class="text-xs opacity-60">Inserts <code>{selected.invocationText}</code> — you review before sending</span>
                {/if}
              {/if}
            </div>
          {:else if creating}
            <!-- New snippet form (reuses the inline editor) -->
            <div class="flex items-start justify-between gap-4 border-b border-base-300 px-5 py-3">
              <div class="flex min-w-0 items-center gap-2">
                <NotebookText size={18} class="shrink-0 text-info" />
                <h3 class="truncate text-lg font-bold leading-tight">New snippet</h3>
              </div>
              <button
                class="btn btn-ghost btn-xs btn-circle"
                aria-label="Close preview"
                onclick={closeDetail}
                type="button">✕</button>
            </div>
            <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
              {#if actionError}
                <p class="mb-3 text-sm text-error">{actionError}</p>
              {/if}
              {@render nameBodyEditor()}
            </div>
            <div class="flex items-center gap-3 border-t border-base-300 px-5 py-3">
              <button class="btn btn-primary btn-sm" disabled={saveDisabled} onclick={saveEditor} type="button">
                Save
              </button>
              <button class="btn btn-ghost btn-sm" disabled={busy} onclick={cancelEditor} type="button">
                Cancel
              </button>
              {#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
            </div>
          {:else}
            <div class="flex flex-1 items-center justify-center p-8 text-center text-sm opacity-60">
              Select an injectable to read its full instructions before inserting.
            </div>
          {/if}
        </div>
      {:else}
        <div bind:this={listEl} class="flex-1 overflow-y-auto p-2">
          {@render listBody()}
        </div>
      {/if}
    </div>

    <!-- Footer: keyboard hints -->
    <div class="flex items-center gap-4 border-t border-base-300 px-5 py-2 text-xs opacity-60">
      <span class="flex items-center gap-1"><kbd class="kbd kbd-xs">↑</kbd><kbd class="kbd kbd-xs">↓</kbd> move</span>
      <span class="flex items-center gap-1"><kbd class="kbd kbd-xs">↵</kbd> insert</span>
      <span class="flex items-center gap-1"><kbd class="kbd kbd-xs">esc</kbd> close</span>
    </div>
  </Modal>

  {#if confirmingDelete && selected}
    <Modal
      onClose={cancelDelete}
      ariaLabel={selected.kind === 'snippet' ? 'Confirm delete snippet' : 'Confirm delete skill'}
      maxWidth="420px"
      initialFocus="button">
      {#snippet header()}
        <h2 class="text-base font-semibold">Delete {selected.kind === 'snippet' ? 'snippet' : 'skill'}</h2>
      {/snippet}
      <div class="px-5 py-4">
        {#if selected.kind === 'snippet'}
          <p class="text-sm leading-relaxed">
            Permanently delete the snippet <code>{selected.name}</code>? This removes it from OpenForge
            and can't be undone.
          </p>
        {:else}
          <p class="text-sm leading-relaxed">
            Permanently delete <code>/{selected.name}</code> from <code>{selected.sourceDir}/skills</code>?
            This removes the skill's folder from disk and can't be undone.
          </p>
        {/if}
        {#if actionError}
          <p class="mt-3 text-sm text-error">{actionError}</p>
        {/if}
      </div>
      <div class="flex items-center justify-end gap-3 border-t border-base-300 px-5 py-3">
        <button class="btn btn-ghost btn-sm" disabled={busy} onclick={cancelDelete} type="button">Cancel</button>
        <button
          data-testid="confirm-delete"
          class="btn btn-error btn-sm"
          disabled={busy}
          onclick={confirmDelete}
          type="button">Delete</button>
      </div>
    </Modal>
  {/if}
{/if}
