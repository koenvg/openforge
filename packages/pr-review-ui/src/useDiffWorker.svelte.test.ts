import { DiffFile } from '@git-diff-view/core'
import { highlighter } from '@git-diff-view/lowlight'
import { flushSync } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { configureDiffHighlighter } from './diffHighlightConfig'
import { createDiffWorker, type DiffWorkerState } from './useDiffWorker.svelte'
import type { DiffWorkerRequest, DiffWorkerResponse } from './diffWorker'
import type { FileContents } from './diffAdapter'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'

const fileWithPatch: PrFileDiff = {
  sha: 'abc123',
  filename: 'src/example.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: '@@ -1,1 +1,1 @@\n-base\n+reviewed',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

const defaultWorker = globalThis.Worker

function buildResult(message: DiffWorkerRequest): DiffWorkerResponse {
  const file = new DiffFile(
    message.data.oldFile.fileName,
    message.data.oldFile.content ?? '',
    message.data.newFile.fileName,
    message.data.newFile.content ?? '',
    message.data.hunks,
    message.data.oldFile.fileLang,
    message.data.newFile.fileLang,
  )

  file.initTheme(message.theme)
  file.initRaw()
  file.initSyntax({ registerHighlighter: highlighter })
  file.buildSplitDiffLines()
  file.buildUnifiedDiffLines()

  const response: DiffWorkerResponse = { type: 'result', id: message.id, bundle: file._getFullBundle() }
  file.clearId()
  return response
}

class FirstResultOnlyWorker {
  static instances: FirstResultOnlyWorker[] = []

  onmessage: ((ev: MessageEvent<DiffWorkerResponse>) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null
  messages: DiffWorkerRequest[] = []

  constructor() {
    FirstResultOnlyWorker.instances.push(this)
  }

  postMessage(message: DiffWorkerRequest): void {
    this.messages.push(message)
    if (this.messages.length !== 1) return

    queueMicrotask(() => {
      this.onmessage?.({ data: buildResult(message) } as MessageEvent<DiffWorkerResponse>)
    })
  }

  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return false }
}

class QueuedWorker {
  static instances: QueuedWorker[] = []

  onmessage: ((ev: MessageEvent<DiffWorkerResponse>) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null
  messages: DiffWorkerRequest[] = []

  constructor() {
    QueuedWorker.instances.push(this)
  }

  postMessage(message: DiffWorkerRequest): void {
    this.messages.push(message)
  }

  emitResult(index: number): void {
    this.onmessage?.({ data: buildResult(this.messages[index]) } as MessageEvent<DiffWorkerResponse>)
  }

  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return false }
}

beforeAll(() => {
  configureDiffHighlighter(highlighter)
})

afterEach(() => {
  globalThis.Worker = defaultWorker
  FirstResultOnlyWorker.instances = []
  QueuedWorker.instances = []
  vi.restoreAllMocks()
})

describe('createDiffWorker', () => {
  it('clears an obsolete DiffFile when the same filename changes comparison context', async () => {
    globalThis.Worker = FirstResultOnlyWorker as unknown as typeof Worker
    const comparisonFile: PrFileDiff = {
      ...fileWithPatch,
      patch: '@@ -1,1 +1,1 @@\n-reviewed\n+changed since review',
      additions: 1,
      deletions: 1,
      changes: 2,
    }
    let files = $state<PrFileDiff[]>([fileWithPatch])
    let contentsMap = $state(new Map<string, FileContents>([
      ['src/example.ts', { oldContent: 'base', newContent: 'reviewed' }],
    ]))
    let workerState!: DiffWorkerState

    const cleanup = $effect.root(() => {
      workerState = createDiffWorker({
        getFiles: () => files,
        getFileContentsMap: () => contentsMap,
        getDiffTheme: () => 'light',
      })
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(workerState.getDiffFile('src/example.ts')).toBeDefined()

    files = [comparisonFile]
    contentsMap = new Map([
      ['src/example.ts', { oldContent: 'reviewed', newContent: 'changed since review' }],
    ])
    flushSync()

    expect(FirstResultOnlyWorker.instances[0].messages).toHaveLength(2)
    expect(workerState.getDiffFile('src/example.ts')).toBeUndefined()
    cleanup()
  })

  it('ignores obsolete worker results when FileContents changes for the same file comparison', async () => {
    globalThis.Worker = QueuedWorker as unknown as typeof Worker
    let files = $state<PrFileDiff[]>([fileWithPatch])
    let contentsMap = $state(new Map<string, FileContents>([
      ['src/example.ts', { oldContent: 'base', newContent: 'reviewed' }],
    ]))
    let workerState!: DiffWorkerState

    const cleanup = $effect.root(() => {
      workerState = createDiffWorker({
        getFiles: () => files,
        getFileContentsMap: () => contentsMap,
        getDiffTheme: () => 'light',
      })
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    contentsMap = new Map([
      ['src/example.ts', { oldContent: 'base', newContent: 'changed since review' }],
    ])
    flushSync()

    const worker = QueuedWorker.instances[0]
    expect(worker.messages).toHaveLength(2)

    worker.emitResult(1)
    const latestDiffFile = workerState.getDiffFile('src/example.ts')
    expect(latestDiffFile).toBeDefined()

    worker.emitResult(0)
    expect(workerState.getDiffFile('src/example.ts')).toBe(latestDiffFile)
    cleanup()
  })

  it('reprocesses mounted diff files for appearance changes without recreating the worker', async () => {
    globalThis.Worker = QueuedWorker as unknown as typeof Worker
    let appearance = $state<'light' | 'dark'>('light')
    let workerState!: DiffWorkerState

    const cleanup = $effect.root(() => {
      workerState = createDiffWorker({
        getFiles: () => [fileWithPatch],
        getFileContentsMap: () => new Map(),
        getDiffTheme: () => appearance,
      })
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    const worker = QueuedWorker.instances[0]
    expect(QueuedWorker.instances).toHaveLength(1)
    expect(worker.messages).toHaveLength(1)
    expect(worker.messages[0].theme).toBe('light')

    appearance = 'dark'
    flushSync()

    expect(QueuedWorker.instances).toHaveLength(1)
    expect(worker.messages).toHaveLength(2)
    expect(worker.messages[1].theme).toBe('dark')
    expect(workerState.getDiffFile(fileWithPatch.filename)).toBeUndefined()
    cleanup()
  })

})
