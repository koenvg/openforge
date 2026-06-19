import type { PrFileDiff } from '@openforge/plugin-sdk/domain'
import { isImageFileDiff, type FileContents } from './diffAdapter'
import { getDiffFileSectionInputKey } from './diffFileSectionIdentity'

export interface FileContentsFetcherState {
  readonly fileContentsMap: Map<string, FileContents>
}

/**
 * Manages batch and per-file content fetching with generation tracking to
 * discard stale results. Resets fetch state when includeUncommitted changes.
 */
export function createFileContentsFetcher(deps: {
  getFiles: () => PrFileDiff[]
  getIncludeUncommitted: () => boolean
  getFetchFileContents: () => ((file: PrFileDiff) => Promise<FileContents>) | undefined
  getBatchFetchFileContents: () => ((files: PrFileDiff[]) => Promise<Map<string, FileContents>>) | undefined
}): FileContentsFetcherState {
  let fileContentsMap = $state<Map<string, FileContents>>(new Map())
  let fetchedKeys = new Map<string, string>()
  let activeFileKeys = new Map<string, string>()
  let fetchGeneration = 0
  let prevIncludeUncommitted: boolean | undefined = undefined
  // Incremented on reset to force the fetch effect to re-run

  let resetSignal = $state(0)
  // Reset file contents when includeUncommitted changes (non-destructive: preserves collapsedFiles/scroll)
  $effect(() => {
    const current = deps.getIncludeUncommitted()
    if (prevIncludeUncommitted !== undefined && prevIncludeUncommitted !== current) {
      // Clear fetch state to trigger re-fetch with new includeUncommitted value
      fetchedKeys = new Map()
      fileContentsMap = new Map()
      fetchGeneration++ // invalidate any in-flight fetches
      resetSignal++ // signal fetch effect to re-run
    }
    prevIncludeUncommitted = current
  })

  $effect(() => {
    const files = deps.getFiles()
    void resetSignal // track reset signal to re-run on includeUncommitted change
    const batchFetchFileContents = deps.getBatchFetchFileContents()
    const fetchFileContents = deps.getFetchFileContents()
    const hasFetcher = batchFetchFileContents || fetchFileContents
    if (!hasFetcher || files.length === 0) return

    const currentFileKeys = new Map(files.map(file => [file.filename, getDiffFileSectionInputKey(file)]))
    let nextContentsMap: Map<string, FileContents> | null = null
    let didFileKeyChange = false
    for (const [filename, previousKey] of activeFileKeys) {
      if (currentFileKeys.get(filename) !== previousKey) {
        didFileKeyChange = true
        fetchedKeys.delete(filename)
        if (fileContentsMap.has(filename)) {
          nextContentsMap ??= new Map(fileContentsMap)
          nextContentsMap.delete(filename)
        }
      }
    }
    activeFileKeys = currentFileKeys
    if (didFileKeyChange) {
      if (nextContentsMap !== null) {
        fileContentsMap = nextContentsMap
      }
      fetchGeneration++
      resetSignal++
      return
    }

    const pendingFiles = files.filter(f => (f.patch || isImageFileDiff(f)) && fetchedKeys.get(f.filename) !== currentFileKeys.get(f.filename))
    if (pendingFiles.length === 0) return

    const thisGeneration = ++fetchGeneration

    if (batchFetchFileContents) {
      // ===========================================================================
      // Batch mode: single IPC call → single Map update → single re-render
      // ===========================================================================
      batchFetchFileContents(pendingFiles).then(results => {
        if (thisGeneration !== fetchGeneration) return // stale, discard
        const next = new Map(fileContentsMap)
        for (const [filename, contents] of results) {
          const fetchKey = currentFileKeys.get(filename)
          if (fetchKey === undefined) continue
          next.set(filename, contents)
          fetchedKeys.set(filename, fetchKey)
        }
        fileContentsMap = next
      }).catch(err => {
        console.error('Failed to batch-fetch file contents:', err)
      })
    } else {
      // ===========================================================================
      // Fallback: per-file fetching (used by PrReviewView)
      // ===========================================================================
      const fetcher = fetchFileContents!
      for (const file of pendingFiles) {
        const filename = file.filename
        const fetchKey = currentFileKeys.get(filename)
        if (fetchKey === undefined) continue
        fetchedKeys.set(filename, fetchKey)
        fetcher(file).then(contents => {
          if (fetchedKeys.get(filename) !== fetchKey) return
          fileContentsMap = new Map(fileContentsMap).set(filename, contents)
        }).catch(err => {
          console.error(`Failed to fetch content for ${filename}:`, err)
        })
      }
    }
  })

  return {
    get fileContentsMap() { return fileContentsMap },
  }
}
