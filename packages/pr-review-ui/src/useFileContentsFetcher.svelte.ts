import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { isImageFileDiff, type FileContents } from './diffAdapter'
import { getDiffFileSectionInputKey } from './diffFileSectionIdentity'

export interface FileContentsFetcherState {
  readonly fileContentsMap: Map<string, FileContents>
  readonly fileContentErrors: Map<string, string>
  retryFileContents: (filename: string) => void
}

function getFetchErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Unknown error'
}

const missingBatchFileContentsError = 'No file contents were returned for this file.'

/**
 * Manages batch and per-file content fetching with generation tracking to
 * discard stale results. Resets fetch state when the diff basis (committed
 * and/or uncommitted scope) changes.
 */
export function createFileContentsFetcher(deps: {
  getFiles: () => PrFileDiff[]
  getIncludeCommitted?: () => boolean
  getIncludeUncommitted: () => boolean
  getFetchFileContents: () => ((file: PrFileDiff) => Promise<FileContents>) | undefined
  getBatchFetchFileContents: () => ((files: PrFileDiff[]) => Promise<Map<string, FileContents>>) | undefined
}): FileContentsFetcherState {
  let fileContentsMap = $state<Map<string, FileContents>>(new Map())
  let fileContentErrors = $state<Map<string, string>>(new Map())
  let fetchedKeys = new Map<string, string>()
  let activeFileKeys = new Map<string, string>()
  let activePerFileRequestIds = new Map<string, number>()
  let nextPerFileRequestId = 0
  let fetchGeneration = 0
  let prevBasis: string | undefined = undefined
  // Incremented on reset to force the fetch effect to re-run

  let resetSignal = $state(0)
  // Reset file contents when the diff basis changes (non-destructive: preserves
  // collapsedFiles/scroll). Both the committed and uncommitted scope flags move
  // the diff's old/new sides, so a change in either must invalidate the cache.
  $effect(() => {
    const includeCommitted = deps.getIncludeCommitted?.() ?? true
    const current = `${includeCommitted}|${deps.getIncludeUncommitted()}`
    if (prevBasis !== undefined && prevBasis !== current) {
      // Clear fetch state to trigger re-fetch with the new diff basis
      fetchedKeys = new Map()
      activePerFileRequestIds = new Map()
      fileContentsMap = new Map()
      fileContentErrors = new Map()
      fetchGeneration++ // invalidate any in-flight fetches
      resetSignal++ // signal fetch effect to re-run
    }
    prevBasis = current
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
    let nextErrorsMap: Map<string, string> | null = null
    let didFileKeyChange = false
    for (const [filename, previousKey] of activeFileKeys) {
      if (currentFileKeys.get(filename) !== previousKey) {
        didFileKeyChange = true
        fetchedKeys.delete(filename)
        activePerFileRequestIds.delete(filename)
        if (fileContentsMap.has(filename)) {
          nextContentsMap ??= new Map(fileContentsMap)
          nextContentsMap.delete(filename)
        }
        if (fileContentErrors.has(filename)) {
          nextErrorsMap ??= new Map(fileContentErrors)
          nextErrorsMap.delete(filename)
        }
      }
    }
    activeFileKeys = currentFileKeys
    if (didFileKeyChange) {
      if (nextContentsMap !== null) {
        fileContentsMap = nextContentsMap
      }
      if (nextErrorsMap !== null) {
        fileContentErrors = nextErrorsMap
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
        const nextErrors = new Map(fileContentErrors)
        for (const file of pendingFiles) {
          const filename = file.filename
          const fetchKey = currentFileKeys.get(filename)
          if (fetchKey === undefined) continue
          const contents = results.get(filename)
          if (contents === undefined) {
            next.delete(filename)
            fetchedKeys.delete(filename)
            nextErrors.set(filename, missingBatchFileContentsError)
            continue
          }
          next.set(filename, contents)
          fetchedKeys.set(filename, fetchKey)
          nextErrors.delete(filename)
        }
        fileContentsMap = next
        fileContentErrors = nextErrors
      }).catch(err => {
        if (thisGeneration !== fetchGeneration) return
        console.error('Failed to batch-fetch file contents:', err)
        const message = getFetchErrorMessage(err)
        const nextErrors = new Map(fileContentErrors)
        for (const file of pendingFiles) nextErrors.set(file.filename, message)
        fileContentErrors = nextErrors
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
        const requestId = ++nextPerFileRequestId
        activePerFileRequestIds.set(filename, requestId)
        fetcher(file).then(contents => {
          if (activePerFileRequestIds.get(filename) !== requestId || fetchedKeys.get(filename) !== fetchKey) return
          activePerFileRequestIds.delete(filename)
          fileContentsMap = new Map(fileContentsMap).set(filename, contents)
          if (fileContentErrors.has(filename)) {
            const nextErrors = new Map(fileContentErrors)
            nextErrors.delete(filename)
            fileContentErrors = nextErrors
          }
        }).catch(err => {
          if (activePerFileRequestIds.get(filename) !== requestId || fetchedKeys.get(filename) !== fetchKey) return
          activePerFileRequestIds.delete(filename)
          console.error(`Failed to fetch content for ${filename}:`, err)
          fileContentErrors = new Map(fileContentErrors).set(filename, getFetchErrorMessage(err))
        })
      }
    }
  })

  function retryFileContents(filename: string) {
    if (!activeFileKeys.has(filename)) return
    fetchedKeys.delete(filename)
    if (deps.getBatchFetchFileContents()) {
      fileContentErrors = new Map()
    } else if (fileContentErrors.has(filename)) {
      const nextErrors = new Map(fileContentErrors)
      nextErrors.delete(filename)
      fileContentErrors = nextErrors
    }
    resetSignal++
  }

  return {
    get fileContentsMap() { return fileContentsMap },
    get fileContentErrors() { return fileContentErrors },
    retryFileContents,
  }
}
