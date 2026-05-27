<script lang="ts">
  import type { PrFileDiff } from '@openforge/plugin-sdk/domain'
  import { getFileStatusIcon, getFileStatusClass } from './fileStatus'

  interface Props {
    files?: PrFileDiff[]
    onSelectFile: (filename: string) => void
    reviewedFileShas?: Map<string, string>
    onToggleFileReviewed?: (file: PrFileDiff, reviewed: boolean) => void
  }

  let { files = [], onSelectFile, reviewedFileShas = new Map(), onToggleFileReviewed }: Props = $props()

  let selectedFile = $state<string | null>(null)
  let expandedDirs = $state(new Set<string>())
  let showReviewedFiles = $state(false)
  let locallyReviewedFiles = $state<Array<{ filename: string; sha: string }>>([])
  let locallyUnreviewedFilenames = $state<string[]>([])

  interface TreeNode {
    name: string
    fullPath: string
    isDir: boolean
    children: Map<string, TreeNode>
    file?: PrFileDiff
  }

  function collectDirPaths(files: PrFileDiff[]): Set<string> {
    const dirs = new Set<string>()
    for (const file of files) {
      const parts = file.filename.split('/')
      for (let i = 0; i < parts.length - 1; i++) {
        dirs.add(parts.slice(0, i + 1).join('/'))
      }
    }
    return dirs
  }

  $effect(() => {
    expandedDirs = collectDirPaths(files)
  })

  function isLocallyReviewed(file: PrFileDiff): boolean {
    return locallyReviewedFiles.some((entry) => entry.filename === file.filename && entry.sha === file.sha)
  }

  function isLocallyUnreviewed(file: PrFileDiff): boolean {
    return locallyUnreviewedFilenames.includes(file.filename)
  }

  function isFileReviewed(file: PrFileDiff): boolean {
    if (isLocallyUnreviewed(file)) return false
    return isLocallyReviewed(file) || reviewedFileShas.get(file.filename) === file.sha
  }

  function getHiddenReviewedCount(): number {
    return files.filter(isFileReviewed).length
  }

  function getVisibleFiles(): PrFileDiff[] {
    return showReviewedFiles ? files : files.filter((file) => !isFileReviewed(file))
  }

  function getTotalStats(): { additions: number; deletions: number } {
    return getVisibleFiles().reduce((acc, f) => ({
      additions: acc.additions + f.additions,
      deletions: acc.deletions + f.deletions,
    }), { additions: 0, deletions: 0 })
  }

  function buildTree(files: PrFileDiff[]): TreeNode {
    const root: TreeNode = { name: '', fullPath: '', isDir: true, children: new Map() }

    for (const file of files) {
      const parts = file.filename.split('/')
      let current = root

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const isLast = i === parts.length - 1
        const fullPath = parts.slice(0, i + 1).join('/')

        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            fullPath,
            isDir: !isLast,
            children: new Map(),
            file: isLast ? file : undefined,
          })
        }

        current = current.children.get(part)!
      }
    }

    return root
  }

  function handleFileClick(file: PrFileDiff) {
    selectedFile = file.filename
    onSelectFile(file.filename)
  }

  function toggleDir(path: string) {
    const next = new Set(expandedDirs)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    expandedDirs = next
  }

  function handleReviewedChange(file: PrFileDiff, event: Event) {
    if (!(event.currentTarget instanceof HTMLInputElement)) return
    if (event.currentTarget.checked) {
      locallyReviewedFiles = [
        ...locallyReviewedFiles.filter((entry) => entry.filename !== file.filename),
        { filename: file.filename, sha: file.sha },
      ]
      locallyUnreviewedFilenames = locallyUnreviewedFilenames.filter((filename) => filename !== file.filename)
    } else {
      locallyReviewedFiles = locallyReviewedFiles.filter((entry) => entry.filename !== file.filename)
      locallyUnreviewedFilenames = [...locallyUnreviewedFilenames.filter((filename) => filename !== file.filename), file.filename]
    }
    onToggleFileReviewed?.(file, event.currentTarget.checked)
  }

  function flattenTree(node: TreeNode, depth: number = 0): Array<{ node: TreeNode; depth: number }> {
    const result: Array<{ node: TreeNode; depth: number }> = []
    const sortedChildren = [...node.children.entries()].sort(([, a], [, b]) => {
      if (a.isDir && !b.isDir) return -1
      if (!a.isDir && b.isDir) return 1
      return a.name.localeCompare(b.name)
    })
    for (const [, child] of sortedChildren) {
      result.push({ node: child, depth })
      if (child.isDir && expandedDirs.has(child.fullPath)) {
        result.push(...flattenTree(child, depth + 1))
      }
    }
    return result
  }

  let flattenedNodes = $derived(flattenTree(buildTree(getVisibleFiles()), 0))
</script>

<div class="flex flex-col h-full bg-base-200 border-r border-base-300">
  <div class="px-3 py-3 border-b border-base-300">
    <div class="flex gap-3 text-xs items-center flex-wrap">
      <span class="text-base-content font-medium">{getVisibleFiles().length} files</span>
      <span class="text-success">+{getTotalStats().additions}</span>
      <span class="text-error">−{getTotalStats().deletions}</span>
      {#if getHiddenReviewedCount() > 0}
        <span class="text-base-content/50">{getHiddenReviewedCount()} reviewed hidden</span>
        <button class="btn btn-ghost btn-xs h-5 min-h-0 px-1" onclick={() => { showReviewedFiles = !showReviewedFiles }}>
          {showReviewedFiles ? 'Hide reviewed files' : 'Show reviewed files'}
        </button>
      {/if}
    </div>
  </div>

  <div class="flex-1 overflow-y-auto py-2">
    {#each flattenedNodes as { node, depth }}
      {#if node.isDir}
        <button
          class="w-full flex items-center gap-2 text-xs text-base-content cursor-pointer hover:bg-base-content/5 transition-colors py-1.5 pr-3"
          style="padding-left: {12 + depth * 16}px"
          onclick={() => toggleDir(node.fullPath)}
        >
          <span class="text-[0.6rem] text-base-content/50 shrink-0">{expandedDirs.has(node.fullPath) ? '▼' : '▶'}</span>
          <span class="text-base-content/50 font-medium flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{node.name}/</span>
        </button>
      {:else if node.file}
        <div
          class="w-full flex items-center gap-2 text-xs transition-colors py-1.5 pr-3 text-base-content {selectedFile === node.file.filename ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-primary/5'}"
          style="padding-left: {selectedFile === node.file.filename ? 10 + depth * 16 : 12 + depth * 16}px"
        >
          {#if onToggleFileReviewed}
            <input
              type="checkbox"
              class="checkbox checkbox-xs shrink-0"
              aria-label="Mark {node.file.filename} reviewed"
              checked={isFileReviewed(node.file)}
              onchange={(event) => node.file && handleReviewedChange(node.file, event)}
            />
          {/if}
          <button
            class="flex min-w-0 flex-1 items-center gap-2 text-left"
            onclick={() => node.file && handleFileClick(node.file)}
          >
            <span class="font-bold text-sm w-4 text-center shrink-0 {getFileStatusClass(node.file.status)}">
              {getFileStatusIcon(node.file.status)}
            </span>
            <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{node.name}</span>
            <span class="flex gap-2 text-[0.7rem] ml-auto shrink-0">
              <span class="text-success">+{node.file.additions}</span>
              <span class="text-error">−{node.file.deletions}</span>
            </span>
          </button>
        </div>
      {/if}
    {/each}
  </div>
</div>
