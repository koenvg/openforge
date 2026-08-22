import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'

interface DiffFileCollapseDependencies {
  getFiles: () => PrFileDiff[]
  getReviewedFileIdentities: () => Map<string, string>
  getFileReviewIdentity: (file: PrFileDiff) => string | null
  getOnToggleFileReviewed: () => ((file: PrFileDiff, reviewed: boolean) => void) | undefined
}

export function createDiffFileCollapse(deps: DiffFileCollapseDependencies) {
  let collapsedFiles = $state(new Set<string>())
  let hasAutoCollapsed = false
  let previousReviewedFileIdentities = new Map<string, string>()

  function isFileReviewed(file: PrFileDiff): boolean {
    const identity = deps.getFileReviewIdentity(file)
    return identity !== null && deps.getReviewedFileIdentities().get(file.filename) === identity
  }

  function getCurrentReviewedFileIdentities(): Map<string, string> {
    const reviewedIdentities = new Map<string, string>()
    const reviewedFileIdentities = deps.getReviewedFileIdentities()
    for (const file of deps.getFiles()) {
      const identity = deps.getFileReviewIdentity(file)
      if (identity !== null && reviewedFileIdentities.get(file.filename) === identity) {
        reviewedIdentities.set(file.filename, identity)
      }
    }
    return reviewedIdentities
  }

  $effect(() => {
    if (hasAutoCollapsed) return
    const files = deps.getFiles()
    if (files.length === 0) return

    collapsedFiles = new Set(
      files
        .filter(file => file.additions + file.deletions > 500 || file.is_truncated)
        .map(file => file.filename),
    )
    hasAutoCollapsed = true
  })

  $effect(() => {
    const currentReviewedFileIdentities = getCurrentReviewedFileIdentities()
    const next = new Set(collapsedFiles)
    let changed = false

    for (const [filename, identity] of currentReviewedFileIdentities) {
      if (previousReviewedFileIdentities.get(filename) !== identity) {
        next.add(filename)
        changed = true
      }
    }

    for (const filename of previousReviewedFileIdentities.keys()) {
      if (!currentReviewedFileIdentities.has(filename)) {
        next.delete(filename)
        changed = true
      }
    }

    previousReviewedFileIdentities = currentReviewedFileIdentities
    if (changed) collapsedFiles = next
  })

  function toggleCollapse(filename: string) {
    const next = new Set(collapsedFiles)
    if (next.has(filename)) {
      next.delete(filename)
    } else {
      next.add(filename)
    }
    collapsedFiles = next
  }

  function uncollapseFile(filename: string) {
    const next = new Set(collapsedFiles)
    next.delete(filename)
    collapsedFiles = next
  }

  function handleReviewedChange(file: PrFileDiff, reviewed: boolean) {
    deps.getOnToggleFileReviewed()?.(file, reviewed)
    const next = new Set(collapsedFiles)
    if (reviewed) {
      next.add(file.filename)
    } else {
      next.delete(file.filename)
    }
    collapsedFiles = next
  }

  return {
    get collapsedFiles() {
      return collapsedFiles
    },
    isFileReviewed,
    handleReviewedChange,
    toggleCollapse,
    uncollapseFile,
  }
}
