<script lang="ts">
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import type { SkillInfo } from './lib/skillDomain'
  import { getSkillLocationLabel } from './lib/skillDomain'

  interface Props {
    activeProjectId: string | null
    skillsCount: number
    isLoading: boolean
    error: string | null
    selectedSkill: SkillInfo | null
    selectedSkillSavePending: boolean
    selectedSkillSourcePath: string
    selectedSkillFileLabel: string
    renderedSkillMarkdown: string
    skillMarkdownHeadingId: string
    editMode: boolean
    editContent: string
    saveError: string | null
    onCancelEdit: () => void
    onSaveEdit: () => void
    onEnterEditMode: () => void
    onEditContentChange: (content: string) => void
    onOpenUrl: (url: string) => void
  }

  let {
    activeProjectId,
    skillsCount,
    isLoading,
    error,
    selectedSkill,
    selectedSkillSavePending,
    selectedSkillSourcePath,
    selectedSkillFileLabel,
    renderedSkillMarkdown,
    skillMarkdownHeadingId,
    editMode,
    editContent,
    saveError,
    onCancelEdit,
    onSaveEdit,
    onEnterEditMode,
    onEditContentChange,
    onOpenUrl,
  }: Props = $props()
</script>

<div class="flex-1 flex flex-col overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
  {#if activeProjectId && selectedSkill}
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
            onclick={onCancelEdit}
            disabled={selectedSkillSavePending}
          >Cancel</button>
          <button
            class="btn btn-primary btn-sm"
            onclick={onSaveEdit}
            disabled={selectedSkillSavePending}
          >{selectedSkillSavePending ? 'Saving...' : 'Save'}</button>
        {:else}
          <button
            class="btn btn-ghost btn-sm text-base-content/70"
            onclick={onEnterEditMode}
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
            <button class="btn btn-xs btn-error btn-outline" onclick={onSaveEdit} disabled={selectedSkillSavePending}>Retry saving skill</button>
          {/if}
        </div>
      </div>
    {/if}

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
      <div class="flex-1 overflow-hidden flex flex-col">
        <textarea
          class="flex-1 w-full p-4 font-mono text-sm text-base-content resize-none border-none outline-none"
          style="background-color: var(--project-bg, oklch(var(--b1)))"
          value={editContent}
          oninput={(event) => onEditContentChange(event.currentTarget.value)}
          spellcheck="false"
        ></textarea>
      </div>
    {:else}
      <div class="flex-1 overflow-y-auto px-6 py-4" role="region" aria-labelledby={skillMarkdownHeadingId}>
        {#if selectedSkill.template}
          <article
            class="max-w-3xl text-base-content leading-relaxed [&_.markdown-body]:text-sm [&_.markdown-body]:leading-relaxed [&_.markdown-body_a]:rounded-sm [&_.markdown-body_a]:focus-visible:outline-none [&_.markdown-body_a]:focus-visible:ring-2 [&_.markdown-body_a]:focus-visible:ring-primary [&_.markdown-body_a]:focus-visible:ring-offset-2 [&_.markdown-body_a]:focus-visible:ring-offset-base-100"
            aria-labelledby={skillMarkdownHeadingId}
          >
            <h4 id={skillMarkdownHeadingId} class="sr-only">{selectedSkill.name} skill markdown</h4>
            <MarkdownContent content={renderedSkillMarkdown} onOpenUrl={onOpenUrl} />
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
    <div class="flex flex-col items-center justify-center h-full gap-4 text-base-content/50 text-center">
      {#if !activeProjectId}
        <span class="text-5xl">📁</span>
        <h3 class="text-lg font-semibold text-base-content/70 m-0">Select a project</h3>
        <p class="text-sm m-0">Choose a project to view and edit its skills.</p>
      {:else if skillsCount > 0}
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
