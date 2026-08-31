import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { isImageFileDiff, isVideoFileDiff, type FileContents } from './diffAdapter'
import { getDiffFileSectionInputKey } from './diffFileSectionIdentity'

export interface FileContentsFetcherState {
  readonly fileContentsMap: Map<string, FileContents>
  readonly fileContentErrors: Map<string, string>
  requestFileContents: (filename: string) => void
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
  let requestedFilenames = new Set<string>()
  let activeFileKeys = new Map<string, string>()
  let activePerFileRequestIds = new Map<string, number>()
  let activeBatchRequestIds = new Map<string, number>()
  let nextBatchRequestId = 0
  let nextPerFileRequestId = 0
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
      activeBatchRequestIds = new Map()
      fileContentsMap = new Map()
      fileContentErrors = new Map()
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
    if (!hasFetcher) return

    const currentFileKeys = new Map(files.map(file => [file.filename, getDiffFileSectionInputKey(file)]))
    let nextContentsMap: Map<string, FileContents> | null = null
    let nextErrorsMap: Map<string, string> | null = null
    let didFileKeyChange = false
    for (const [filename, previousKey] of activeFileKeys) {
      if (currentFileKeys.get(filename) !== previousKey) {
        didFileKeyChange = true
        if (!currentFileKeys.has(filename)) requestedFilenames.delete(filename)
        fetchedKeys.delete(filename)
        activePerFileRequestIds.delete(filename)
        activeBatchRequestIds.delete(filename)
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
      resetSignal++
      return
    }

    const pendingFiles = files.filter(file => {
      const currentKey = currentFileKeys.get(file.filename)
      if (currentKey === undefined || fetchedKeys.get(file.filename) === currentKey) return false
      if (isVideoFileDiff(file)) return requestedFilenames.has(file.filename)
      return Boolean(file.patch || isImageFileDiff(file))
    })
    if (pendingFiles.length === 0) return


    if (batchFetchFileContents) {
      // ===========================================================================
      // Batch mode: reserve each file before dispatch so staggered video requests
      // can start independently without duplicating in-flight work.
      // ===========================================================================
      const requestId = ++nextBatchRequestId
      const requestKeys = new Map<string, string>()
      for (const file of pendingFiles) {
        const fetchKey = currentFileKeys.get(file.filename)
        if (fetchKey === undefined) continue
        requestKeys.set(file.filename, fetchKey)
        fetchedKeys.set(file.filename, fetchKey)
        activeBatchRequestIds.set(file.filename, requestId)
      }

      batchFetchFileContents(pendingFiles).then(results => {
        const next = new Map(fileContentsMap)
        const nextErrors = new Map(fileContentErrors)
        for (const file of pendingFiles) {
          const filename = file.filename
          const fetchKey = requestKeys.get(filename)
          if (fetchKey === undefined
            || activeBatchRequestIds.get(filename) !== requestId
            || fetchedKeys.get(filename) !== fetchKey) continue
          activeBatchRequestIds.delete(filename)
          const contents = results.get(filename)
          if (contents === undefined) {
            next.delete(filename)
            fetchedKeys.delete(filename)
            nextErrors.set(filename, missingBatchFileContentsError)
            continue
          }
          next.set(filename, contents)
          nextErrors.delete(filename)
        }
        fileContentsMap = next
        fileContentErrors = nextErrors
      }).catch(err => {
        const message = getFetchErrorMessage(err)
        const nextErrors = new Map(fileContentErrors)
        let hasActiveRequest = false
        for (const file of pendingFiles) {
          const filename = file.filename
          const fetchKey = requestKeys.get(filename)
          if (fetchKey === undefined
            || activeBatchRequestIds.get(filename) !== requestId
            || fetchedKeys.get(filename) !== fetchKey) continue
          activeBatchRequestIds.delete(filename)
          nextErrors.set(filename, message)
          hasActiveRequest = true
        }
        if (!hasActiveRequest) return
        console.error('Failed to batch-fetch file contents:', err)
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

  function requestFileContents(filename: string) {
    const file = deps.getFiles().find(candidate => candidate.filename === filename)
    if (!file || !isVideoFileDiff(file) || requestedFilenames.has(filename)) return
    requestedFilenames = new Set(requestedFilenames).add(filename)
    resetSignal++
  }

  function retryFileContents(filename: string) {
    if (!activeFileKeys.has(filename)) return
    fetchedKeys.delete(filename)
    activeBatchRequestIds.delete(filename)
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
    requestFileContents,
    retryFileContents,
  }
}
