<script lang="ts">
  import { untrack } from 'svelte'
  import ProjectFileTree from '@openforge-app/plugin-sdk/ui/ProjectFileTree.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import type { FileEntry } from '@openforge-app/plugin-sdk'

  let { scenario = 'populated', side = 'left', initialSelection = null }: {
    scenario?: 'populated' | 'empty' | 'loading' | 'error' | 'overflow'
    side?: 'left' | 'right'
    initialSelection?: string | null
  } = $props()
  let selected = $state(untrack(() => initialSelection))
  let expanded = $state(new Set(['src']))
  let recovered = $state(false)
  const file = (path: string, isDir = false): FileEntry => ({
    path, name: path.split('/').at(-1)!, isDir, size: isDir ? null : 2048, modifiedAt: 1767346200000,
  })
  const entries = $derived(scenario === 'empty' ? [] : [file('src', true), file('src/index.ts'), file('src/plugin.ts'), file('README.md'),
    ...(scenario === 'overflow' ? Array.from({ length: 40 }, (_, i) => file(`src/extension-with-a-long-name-${i}.ts`)) : []),
  ])
  function toggle(path: string) {
    const next = new Set(expanded)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    expanded = next
  }
</script>

<div class="flex h-full min-h-0 min-w-0 overflow-hidden" style:flex-direction={side === 'right' ? 'row-reverse' : 'row'}>
  <ResizablePanel storageKey="catalog-sdk-files" defaultWidth={240} minWidth={160} maxWidth={360} {side} label="files">
    <PluginViewState loading={scenario === 'loading'} error={scenario === 'error' && !recovered ? 'The local file index could not be read.' : null}
      empty={scenario === 'empty'} emptyTitle="No files yet" onRetry={() => { recovered = true }}>
      <ProjectFileTree {entries} expandedDirs={expanded} selectedPath={selected} onToggleDir={toggle} onSelectFile={(path) => { selected = path }} />
    </PluginViewState>
  </ResizablePanel>
  <div class="min-w-0 flex-1 overflow-auto border-l border-of-border p-4">
    {#if selected}
      <MarkdownContent content={selected === 'README.md' ? '# Repository guide\n\nRun `pnpm test` before publishing.\n\n- Use typed commands\n- Keep plugin data local' : `# ${selected}\n\n\`\`\`typescript\nexport const plugin = { id: 'local.example' }\n\`\`\``} />
    {:else}
      <PluginViewState empty emptyTitle="Select a file to preview" emptyDescription="Browse the project tree with the arrow keys." />
    {/if}
  </div>
</div>
