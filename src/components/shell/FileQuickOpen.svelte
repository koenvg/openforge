<script lang="ts">
  import { onDestroy } from 'svelte'
  import { activeProjectId } from '../../lib/stores'
  import { fsSearchFiles } from '../../lib/ipc'
  import { revealFileInFileViewer } from '../../lib/fileViewerPlugin'
  import { FILE_VIEWER_VIEW_KEY } from '../../lib/fileViewerView'
  import { useAppRouter } from '../../lib/router.svelte'
  import PaletteFooter from '../shared/ui/PaletteFooter.svelte'
  import PaletteInput from '../shared/ui/PaletteInput.svelte'
  import PaletteListbox from '../shared/ui/PaletteListbox.svelte'
  import PaletteModal from './PaletteModal.svelte'

  interface Props { onClose: () => void }

  let { onClose }: Props = $props()
  const router = useAppRouter()
  let searchQuery = $state('')
  let results = $state<string[]>([])
  let loading = $state(false)
  let selectedIndex = $state(0)
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let paletteListbox: { handleKeydown: (event: KeyboardEvent) => boolean } | null = $state(null)
  let filteredResults = $derived(results.filter(path => !path.endsWith('/')))

  function closeModal() {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
    onClose()
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    return paletteListbox?.handleKeydown(event) ?? false
  }

  async function searchFiles(query: string) {
    const projectId = $activeProjectId
    if (!projectId || !query.trim()) {
      results = []
      loading = false
      return
    }
    loading = true
    try {
      results = await fsSearchFiles(projectId, query, 50)
    } catch (error) {
      console.error('[FileQuickOpen] search failed:', error)
      results = []
    } finally {
      loading = false
    }
  }

  function handleInput() {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchTimer = null
      void searchFiles(searchQuery)
    }, 150)
  }

  async function handleSelectFile(path: string) {
    try {
      await revealFileInFileViewer(path)
    } catch (error) {
      console.error('[FileQuickOpen] reveal failed:', error)
    } finally {
      router.navigate(FILE_VIEWER_VIEW_KEY)
      closeModal()
    }
  }

  function getFileName(path: string): string { return path.split('/').at(-1) ?? path }
  function getDirectory(path: string): string {
    const parts = path.split('/')
    return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
  }

  $effect(() => {
    filteredResults.length
    selectedIndex = 0
  })

  onDestroy(() => {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
  })
</script>

<PaletteModal ariaLabel="Search files" testId="file-quick-open-backdrop" onClose={closeModal} onKeydown={handleKeyDown}>
  <PaletteListbox
    bind:this={paletteListbox}
    items={filteredResults}
    {selectedIndex}
    onSelectedIndexChange={(index) => { selectedIndex = index }}
    onSelect={(path) => void handleSelectFile(path)}
    getKey={(path) => path}
    idPrefix="file-quick-open"
    listboxLabel="Files"
    onCancel={closeModal}
    {loading}
    listClass="max-h-[400px] overflow-y-auto"
    optionClass={(_path, _index, highlighted) => `flex items-center gap-3 w-full px-4 py-2 text-left text-sm text-base-content transition-colors ${highlighted ? 'bg-base-300' : 'hover:bg-base-300/60'}`}
  >
    {#snippet input(listboxId, activeDescendantId)}
      <PaletteInput {listboxId} {activeDescendantId} bind:value={searchQuery} placeholder="Search files..." onInput={handleInput} />
    {/snippet}
    {#snippet loadingContent()}
      <div class="px-4 py-6 text-center text-base-content/50 text-sm">Searching...</div>
    {/snippet}
    {#snippet emptyContent()}
      <div class="px-4 py-6 text-center text-base-content/50 text-sm">
        {#if !$activeProjectId}Select a project first{:else if searchQuery.trim()}No files match your search{:else}Type to search files...{/if}
      </div>
    {/snippet}
    {#snippet item(filePath)}
      <div class="flex-1 min-w-0">
        <div class="font-medium truncate">{getFileName(filePath)}</div>
        <div class="text-xs text-base-content/50 truncate">{getDirectory(filePath)}</div>
      </div>
    {/snippet}
  </PaletteListbox>
  {#if filteredResults.length === 50}
    <div class="px-4 py-1.5 border-t border-base-300 text-xs text-base-content/40 text-center">Showing top 50 results</div>
  {/if}
  <PaletteFooter actionLabel="open file" />
</PaletteModal>
