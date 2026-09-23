<script lang="ts">
  import type { Action } from 'svelte/action'
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import { getLanguageForFile, highlightCode } from './lib/fileHighlighter'
  import MarkdownFilePreview from './MarkdownFilePreview.svelte'
  import type { FileBrowserWorkspaceSource } from './lib/workspaceSource'

  let { api, content, fileName, filePath, workspaceSource, scrollTop = 0, onScrollTopChange, onOpenRepositoryPath, registerScrollRegion }: {
    api: FrontendOpenForgeAPI
    content: string
    fileName: string
    filePath: string
    workspaceSource: FileBrowserWorkspaceSource | null
    scrollTop?: number
    onScrollTopChange?: (scrollTop: number) => void
    onOpenRepositoryPath?: (repositoryPath: string) => void | Promise<void>
    registerScrollRegion: Action<HTMLDivElement>
  } = $props()

  const language = $derived(getLanguageForFile(fileName))
  const textLines = $derived(content.split('\n'))
  const highlightedCode = $derived(language === 'markdown' ? '' : highlightCode(content, fileName))
</script>

{#if language === 'markdown'}
  <MarkdownFilePreview
    {api}
    {content}
    {filePath}
    {workspaceSource}
    {scrollTop}
    {onScrollTopChange}
    onOpenRepositoryPath={onOpenRepositoryPath
      ? (target) => onOpenRepositoryPath?.(target.repositoryPath)
      : undefined}
  />
{:else}
  <div
    class="flex-1 min-h-0 overflow-auto p-4"
    role="region"
    aria-label="File text content"
    use:registerScrollRegion
    onscroll={(event) => onScrollTopChange?.(event.currentTarget.scrollTop)}
  >
    <div class="font-mono text-sm min-w-max">
      <div class="flex leading-6">
        <div class="w-12 shrink-0 pr-3 text-right text-of-text/30 select-none flex flex-col" aria-hidden="true">
          {#each textLines as _, index}
            <span id="L{index + 1}">{index + 1}</span>
          {/each}
        </div>
        <code class="file-preview-code block flex-1 whitespace-pre {language ? `language-${language}` : ''}">{@html highlightedCode || ' '}</code>
      </div>
    </div>
  </div>
{/if}
