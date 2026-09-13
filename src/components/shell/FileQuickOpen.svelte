<script lang="ts">
  import { onDestroy } from 'svelte'
  import { activeProjectId } from '../../lib/stores'
  import { fsSearchFiles } from '../../lib/ipc'
  import { revealFileInFileViewer } from '../../lib/fileViewerPlugin'
  import { FILE_VIEWER_VIEW_KEY } from '../../lib/fileViewerView'
  import { useAppRouter } from '../../lib/router.svelte'
  import SearchPalette from '@openforge-app/plugin-sdk/ui/SearchPalette.svelte'

  interface Props { onClose: () => void }

  let { onClose }: Props = $props()
  const router = useAppRouter()
  let searchQuery = $state('')
  let results = $state<string[]>([])
  let loading = $state(false)
  let selectedIndex = $state(0)
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let filteredResults = $derived(results.filter(path => !path.endsWith('/')))

  function closeModal() {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
    onClose()
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

<SearchPalette
  ariaLabel="Search files" testId="file-quick-open-backdrop" onClose={closeModal}
  items={filteredResults} query={searchQuery}
  onQueryChange={(query) => { searchQuery = query; handleInput() }}
  {selectedIndex} onSelectedIndexChange={(index) => { selectedIndex = index }}
  onSelect={(path) => void handleSelectFile(path)} getKey={(path) => path}
  listboxLabel="Files" placeholder="Search files..." {loading} maxResultsHeight="400px" actionLabel="open file"
 >
  {#snippet loadingContent()}Searching...{/snippet}
  {#snippet emptyContent()}
    {#if !$activeProjectId}Select a project first{:else if searchQuery.trim()}No files match your search{:else}Type to search files...{/if}
  {/snippet}
  {#snippet item(filePath)}
    <div class="font-medium truncate">{getFileName(filePath)}</div>
    <div class="text-xs text-of-text/50 truncate">{getDirectory(filePath)}</div>
  {/snippet}
  {#snippet resultsFooter()}
    {#if filteredResults.length === 50}
      <div class="px-4 py-1.5 border-t border-of-border text-xs text-of-text/40 text-center">Showing top 50 results</div>
    {/if}
  {/snippet}
</SearchPalette>
