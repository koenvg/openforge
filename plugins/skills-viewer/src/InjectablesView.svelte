<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import type { Injectable, InjectableSection } from '@openforge-app/plugin-sdk'
  import {
    searchInjectables,
    filterInjectables,
    groupInjectables,
    sectionOf,
    SECTION_ORDER,
    ORIGIN_LABELS,
    isEditablePersonalSkill,
    isEditableSnippet,
    snippetDbId,
    formatCharCount,
  } from '@openforge-app/plugin-sdk/injectables'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
  import { createSnippet, updateSnippet, deleteSnippet } from '@openforge-app/plugin-sdk/injectables'
  import { loadInjectableCatalog } from './lib/injectableCatalog'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId?: string | null
  }

  let { api, context: _context, projectName, projectId = null }: Props = $props()

  type Mode = 'view' | 'edit-skill' | 'new-snippet' | 'edit-snippet'

  let injectables = $state<Injectable[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)
  let search = $state('')
  let activeSection = $state<InjectableSection | null>(null)
  let selectedId = $state<string | null>(null)
  let mode = $state<Mode>('view')
  let busy = $state(false)
  let actionError = $state<string | null>(null)
  let confirmingDelete = $state(false)
  let copied = $state(false)

  // Skill edit + snippet form drafts
  let editContent = $state('')
  let snippetName = $state('')
  let snippetBody = $state('')
  let snippetAllProjects = $state(true)

  let previousProjectId: string | null | undefined = undefined
  let loadRequestId = 0

  let filtered = $derived(
    filterInjectables(searchInjectables(injectables, search), activeSection ? { sections: [activeSection] } : {}),
  )
  let groups = $derived(groupInjectables(filtered, 'origin'))
  let selected = $derived(injectables.find((i) => i.id === selectedId) ?? null)
  let sectionsPresent = $derived(
    SECTION_ORDER.filter((section) => injectables.some((i) => sectionOf(i) === section)),
  )
  let canEditSkill = $derived(selected ? isEditablePersonalSkill(selected) : false)
  let canEditSnippet = $derived(selected ? isEditableSnippet(selected) : false)

  async function reload() {
    const requestId = ++loadRequestId
    loading = true
    error = null
    try {
      const result = await loadInjectableCatalog(api, projectId)
      if (requestId !== loadRequestId) return
      injectables = result.injectables
      if (!injectables.some((i) => i.id === selectedId)) {
        selectedId = injectables[0]?.id ?? null
      }
    } catch (e) {
      if (requestId !== loadRequestId) return
      error = e instanceof Error ? e.message : String(e)
      injectables = []
    } finally {
      if (requestId === loadRequestId) loading = false
    }
  }

  $effect(() => {
    if (projectId === previousProjectId) return
    previousProjectId = projectId
    selectedId = null
    mode = 'view'
    void reload()
  })

  function select(id: string) {
    selectedId = id
    mode = 'view'
    actionError = null
    confirmingDelete = false
  }

  async function copySelected() {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(selected.invocationText)
      copied = true
      setTimeout(() => { copied = false }, 1500)
    } catch (e) {
      actionError = `Copy failed: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  function startNewSnippet() {
    mode = 'new-snippet'
    snippetName = ''
    snippetBody = ''
    snippetAllProjects = true
    actionError = null
  }

  function startEditSnippet() {
    if (!selected) return
    mode = 'edit-snippet'
    snippetName = selected.name
    snippetBody = selected.content ?? selected.invocationText
    snippetAllProjects = true
    actionError = null
  }

  function startEditSkill() {
    if (!selected) return
    mode = 'edit-skill'
    editContent = selected.content ?? ''
    actionError = null
  }

  function cancelEdit() {
    mode = 'view'
    actionError = null
  }

  async function saveSnippet() {
    if (busy) return
    busy = true
    actionError = null
    // Simplified scope: all projects, or scoped to the current project when off.
    const projectIds = snippetAllProjects ? [] : projectId ? [projectId] : []
    try {
      if (mode === 'edit-snippet' && selected) {
        const id = snippetDbId(selected)
        if (id) await updateSnippet(api.storage.global, id, { name: snippetName, body: snippetBody, allProjects: snippetAllProjects, projectIds })
      } else {
        const created = await createSnippet(api.storage.global, { name: snippetName, body: snippetBody, allProjects: snippetAllProjects, projectIds })
        selectedId = `snippet:${created.id}`
      }
      mode = 'view'
      await reload()
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function saveSkill() {
    if (busy || !selected) return
    busy = true
    actionError = null
    try {
      await api.backend.whenReady()
      await api.backend.invoke('saveSkillContent', {
        projectId,
        name: selected.name,
        level: selected.origin === 'personal' ? 'user' : 'project',
        sourceDir: selected.sourceDir,
        sourcePath: selected.sourcePath,
        content: editContent,
      })
      mode = 'view'
      await reload()
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function confirmDelete() {
    if (busy || !selected) return
    busy = true
    actionError = null
    try {
      if (canEditSnippet) {
        const id = snippetDbId(selected)
        if (id) await deleteSnippet(api.storage.global, id)
      } else if (canEditSkill) {
        await api.backend.whenReady()
        await api.backend.invoke('deleteSkill', {
          projectId,
          name: selected.name,
          level: selected.origin === 'personal' ? 'user' : 'project',
          sourceDir: selected.sourceDir,
          sourcePath: selected.sourcePath,
        })
      }
      confirmingDelete = false
      selectedId = null
      await reload()
    } catch (e) {
      actionError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <PluginPageHeader
    title={projectName ? `${projectName} — Skills` : 'Skills'}
    subtitle={projectId ? 'Skills, commands, and personal snippets' : 'Select a project to view skills'}
  >
    {#snippet actions()}
      <div class="flex items-center gap-2">
        <span class="badge badge-primary badge-sm">{injectables.length}</span>
        <button class="btn btn-sm btn-primary" onclick={startNewSnippet}>+ Snippet</button>
        <button class="btn btn-sm border border-base-300" onclick={() => void reload()} disabled={loading || !projectId}>
          {loading ? '⟳' : '↻'} Refresh
        </button>
      </div>
    {/snippet}
  </PluginPageHeader>

  <div class="flex flex-1 overflow-hidden">
    <!-- List -->
    <div class="flex w-96 shrink-0 flex-col border-r border-base-300 overflow-hidden">
      <div class="p-2 border-b border-base-300 flex flex-col gap-2">
        <input
          type="text"
          class="input input-sm input-bordered w-full"
          placeholder="Search skills, commands, snippets…"
          bind:value={search}
        />
        <div class="flex flex-wrap gap-1">
          <button class="btn btn-xs" class:btn-active={activeSection === null} onclick={() => { activeSection = null }}>All</button>
          {#each sectionsPresent as section (section)}
            <button class="btn btn-xs" class:btn-active={activeSection === section} onclick={() => { activeSection = section }}>
              {section === 'snippet' ? 'Snippets' : ORIGIN_LABELS[section]}
            </button>
          {/each}
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        {#if loading}
          <p class="text-sm opacity-60 p-2">Loading…</p>
        {:else if error}
          <p class="text-sm text-error p-2">{error}</p>
        {:else if !projectId}
          <p class="text-sm opacity-60 p-2">Select a project to view its skills.</p>
        {:else if filtered.length === 0}
          <p class="text-sm opacity-60 p-2">No matches.</p>
        {:else}
          {#each groups as group (group.key)}
            <div class="mb-3">
              <p class="text-xs font-semibold uppercase opacity-50 px-2 py-1">{group.label}</p>
              {#each group.items as item (item.id)}
                <button
                  class="btn btn-ghost btn-sm w-full justify-start font-normal"
                  class:btn-active={item.id === selectedId}
                  onclick={() => select(item.id)}
                >
                  <span class="truncate">{item.name}</span>
                </button>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Detail -->
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      {#if !selected && mode !== 'new-snippet'}
        <div class="flex flex-1 items-center justify-center text-sm opacity-60">
          Select an item to view it.
        </div>
      {:else if mode === 'new-snippet' || mode === 'edit-snippet'}
        <div class="flex flex-col gap-3 p-4 overflow-y-auto">
          <h2 class="text-lg font-semibold">{mode === 'new-snippet' ? 'New snippet' : 'Edit snippet'}</h2>
          <input type="text" class="input input-bordered" placeholder="Name" bind:value={snippetName} />
          <textarea class="textarea textarea-bordered min-h-48 font-mono text-sm" placeholder="Body (inserted verbatim)" bind:value={snippetBody}></textarea>
          <label class="label cursor-pointer justify-start gap-2">
            <input type="checkbox" class="checkbox checkbox-sm" bind:checked={snippetAllProjects} />
            <span class="label-text">Available in all projects</span>
          </label>
          {#if actionError}<p class="text-sm text-error">{actionError}</p>{/if}
          <div class="flex gap-2">
            <button class="btn btn-sm btn-primary" onclick={() => void saveSnippet()} disabled={busy}>Save</button>
            <button class="btn btn-sm" onclick={cancelEdit} disabled={busy}>Cancel</button>
          </div>
        </div>
      {:else if selected}
        <div class="flex items-start justify-between gap-2 p-4 border-b border-base-300">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold truncate">{selected.name}</h2>
            <p class="text-xs opacity-60">
              {selected.kind}{selected.sourcePath ? ` · ${selected.sourcePath}` : ''}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button class="btn btn-sm btn-primary" onclick={() => void copySelected()}>{copied ? 'Copied ✓' : 'Copy'}</button>
            {#if canEditSnippet}
              <button class="btn btn-sm" onclick={startEditSnippet}>Edit</button>
            {:else if canEditSkill}
              <button class="btn btn-sm" onclick={startEditSkill}>Edit</button>
            {/if}
            {#if canEditSnippet || canEditSkill}
              {#if confirmingDelete}
                <button class="btn btn-sm btn-error" onclick={() => void confirmDelete()} disabled={busy}>Confirm delete</button>
                <button class="btn btn-sm" onclick={() => { confirmingDelete = false }} disabled={busy}>Cancel</button>
              {:else}
                <button class="btn btn-sm btn-ghost text-error" onclick={() => { confirmingDelete = true }}>Delete</button>
              {/if}
            {/if}
          </div>
        </div>

        {#if actionError}<p class="text-sm text-error px-4 pt-2">{actionError}</p>{/if}

        <div class="flex-1 overflow-y-auto p-4">
          {#if mode === 'edit-skill'}
            <textarea class="textarea textarea-bordered w-full min-h-96 font-mono text-sm" bind:value={editContent}></textarea>
            <p class="text-xs opacity-50 mt-1">{formatCharCount(editContent.length)}</p>
            <div class="flex gap-2 mt-2">
              <button class="btn btn-sm btn-primary" onclick={() => void saveSkill()} disabled={busy}>Save</button>
              <button class="btn btn-sm" onclick={cancelEdit} disabled={busy}>Cancel</button>
            </div>
          {:else if selected.content}
            <MarkdownContent content={selected.content} onOpenUrl={(url) => api.system.openUrl(url)} />
          {:else}
            <p class="text-sm opacity-60">No preview content.</p>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
