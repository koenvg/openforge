<script lang="ts">
  import CollapsibleSection from '@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte'
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
  import PluginPageShell from '@openforge-app/plugin-sdk/ui/PluginPageShell.svelte'
  import ProjectFileTree from '@openforge-app/plugin-sdk/ui/ProjectFileTree.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import type { FileEntry } from '@openforge-app/plugin-sdk'

  let { themes }: { themes: { id: string; properties: Record<string, string> }[] } = $props()
  let themeId = $state(themes[0].id)
  let selected = $state<string | null>(null)
  let expanded = $state(new Set(['src']))
  let draft = $state('Keep this draft')
  const entries: FileEntry[] = [
    { path: 'src', name: 'src', isDir: true, size: null, modifiedAt: 0 },
    { path: 'src/index.ts', name: 'index.ts', isDir: false, size: 2048, modifiedAt: 0 },
  ]
  $effect(() => {
    const properties = themes.find(theme => theme.id === themeId)!.properties
    for (const [name, value] of Object.entries(properties)) document.documentElement.style.setProperty(name, value)
  })
</script>

<label>Theme <select bind:value={themeId}>{#each themes as theme}<option value={theme.id}>{theme.id}</option>{/each}</select></label>
<label>Draft <input bind:value={draft} /></label>
<main>
  <PluginPageShell>
    {#snippet header()}<PluginPageHeader title="SDK workspace" subtitle="Active files" />{/snippet}
    <div class="workspace">
      <ResizablePanel storageKey="sdk-views-packed" defaultWidth={240} minWidth={160} maxWidth={360} label="files">
        <ProjectFileTree {entries} expandedDirs={expanded} selectedPath={selected}
          onToggleDir={(path) => { expanded = new Set(expanded.has(path) ? [] : [path]) }}
          onSelectFile={(path) => selected = path} />
      </ResizablePanel>
      <div class="content">
        <CollapsibleSection sectionKey="sdk-views-packed" title="Details"><p>File details</p></CollapsibleSection>
      </div>
    </div>
  </PluginPageShell>
</main>

<style>
  :global(body) { margin: 0; font-family: var(--of-font-sans); }
  main { height: 480px; }
  .workspace { display: flex; flex: 1; min-height: 0; }
  .content { flex: 1; min-width: 0; }
</style>
