import { DiffFile } from '@git-diff-view/core'
import { toGitDiffViewData, type FileContents } from './diffAdapter'
import { getDiffFileSectionInputKey } from './diffFileSectionIdentity'
import type { PrFileDiff } from '@openforge/plugin-sdk/domain'
import type { DiffWorkerResponse } from './diffWorker'

export interface DiffWorkerState {
  getDiffFile(filename: string): DiffFile | undefined
  readonly processing: boolean
}

export function createDiffWorker(deps: {
  getFiles: () => PrFileDiff[]
  getFileContentsMap: () => Map<string, FileContents>
  getDiffTheme: () => 'light' | 'dark'
}): DiffWorkerState {
  let diffFileMap = $state<Map<string, DiffFile>>(new Map())
  let pendingCount = $state(0)

  const sentKeys = new Map<string, { fileKey: string; contents: FileContents | undefined }>()
  const pendingRequestKeys = new Map<string, { filename: string; fileKey: string }>()
  const latestRequestIds = new Map<string, string>()
  let nextRequestId = 0
  let lastSentTheme: string | null = null

  const worker = new Worker(
    new URL('./diffWorker.ts', import.meta.url),
    { type: 'module' }
  )

  function clearDiffFile(filename: string) {
    if (!diffFileMap.has(filename)) return

    const next = new Map(diffFileMap)
    next.get(filename)?.clearId()
    next.delete(filename)
    diffFileMap = next
  }

  worker.onmessage = (e: MessageEvent<DiffWorkerResponse>) => {
    const msg = e.data
    const pending = pendingRequestKeys.get(msg.id)
    pendingRequestKeys.delete(msg.id)

    if (msg.type === 'result') {
      if (pending && sentKeys.get(pending.filename)?.fileKey === pending.fileKey && latestRequestIds.get(pending.filename) === msg.id) {
        const diffFile = DiffFile.createInstance({}, msg.bundle)
        const next = new Map(diffFileMap)
        next.set(pending.filename, diffFile)
        diffFileMap = next
      }
      pendingCount = Math.max(0, pendingCount - 1)
    } else if (msg.type === 'error') {
      console.error(`[DiffWorker] Failed to process ${pending?.filename ?? msg.id}:`, msg.error)
      pendingCount = Math.max(0, pendingCount - 1)
    }
  }

  $effect(() => {
    const files = deps.getFiles()
    const contentsMap = deps.getFileContentsMap()
    const theme = deps.getDiffTheme()

    const themeChanged = lastSentTheme !== null && lastSentTheme !== theme
    if (themeChanged) {
      sentKeys.clear()
      pendingRequestKeys.clear()
      latestRequestIds.clear()
      for (const df of diffFileMap.values()) df.clearId()
      diffFileMap = new Map()
    }
    lastSentTheme = theme

    const currentFilenames = new Set(files.map(f => f.filename))
    for (const key of sentKeys.keys()) {
      if (!currentFilenames.has(key)) {
        sentKeys.delete(key)
        latestRequestIds.delete(key)
        clearDiffFile(key)
      }
    }

    for (const file of files) {
      if (!file.patch) continue

      const contents = contentsMap.get(file.filename)
      const fileKey = getDiffFileSectionInputKey(file)
      const sent = sentKeys.get(file.filename)
      if (sent?.fileKey === fileKey && sent.contents === contents) continue

      clearDiffFile(file.filename)
      sentKeys.set(file.filename, { fileKey, contents })

      const data = toGitDiffViewData(file, contents)
      const requestId = `${file.filename}:${++nextRequestId}`
      pendingRequestKeys.set(requestId, { filename: file.filename, fileKey })
      latestRequestIds.set(file.filename, requestId)

      worker.postMessage({
        type: 'process',
        id: requestId,
        data,
        theme,
      })
      pendingCount++
    }
  })

  $effect(() => {
    return () => {
      worker.terminate()
      for (const df of diffFileMap.values()) {
        df.clearId()
      }
    }
  })

  return {
    getDiffFile(filename: string) { return diffFileMap.get(filename) },
    get processing() { return pendingCount > 0 },
  }
}
