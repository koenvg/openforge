import { getImagePreviewDataUrl, type FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
import type { FileContentRequest } from './ipc'
import type { PrFileDiff } from './types'

export interface SelfReviewContext {
  taskId: string
  selectedCommitSha: string | null
  includeCommitted: boolean
  includeUncommitted: boolean
}

export type SelfReviewFileContentContext = SelfReviewContext

export interface SelfReviewFileContentLoaderOptions {
  getContext: () => SelfReviewFileContentContext
  getComparisonContents: (filename: string) => FileContents | undefined
  getTaskFileContents: (
    taskId: string,
    path: string,
    oldPath: string | null,
    status: string,
    includeCommitted: boolean,
    includeUncommitted: boolean,
  ) => Promise<FileContents>
  getTaskBatchFileContents: (
    taskId: string,
    files: FileContentRequest[],
    includeCommitted: boolean,
    includeUncommitted: boolean,
  ) => Promise<FileContents[]>
  getCommitFileContents: (
    taskId: string,
    commitSha: string,
    path: string,
    oldPath: string | null,
    status: string,
  ) => Promise<FileContents>
  getCommitBatchFileContents: (
    taskId: string,
    commitSha: string,
    files: FileContentRequest[],
  ) => Promise<FileContents[]>
}

interface FileContentSource {
  fetch(request: FileContentRequest): Promise<FileContents>
  fetchBatch(requests: FileContentRequest[]): Promise<FileContents[]>
}

function createFileContentSource(
  options: SelfReviewFileContentLoaderOptions,
  context: SelfReviewFileContentContext,
): FileContentSource {
  const { selectedCommitSha } = context
  if (selectedCommitSha !== null) {
    return {
      fetch: (request) => options.getCommitFileContents(
        context.taskId,
        selectedCommitSha,
        request.path,
        request.oldPath,
        request.status,
      ),
      fetchBatch: (requests) => options.getCommitBatchFileContents(
        context.taskId,
        selectedCommitSha,
        requests,
      ),
    }
  }

  return {
    fetch: (request) => options.getTaskFileContents(
      context.taskId,
      request.path,
      request.oldPath,
      request.status,
      context.includeCommitted,
      context.includeUncommitted,
    ),
    fetchBatch: (requests) => options.getTaskBatchFileContents(
      context.taskId,
      requests,
      context.includeCommitted,
      context.includeUncommitted,
    ),
  }
}

export interface SelfReviewFileContentLoader {
  fetch(file: PrFileDiff): Promise<FileContents>
  fetchCurrent(file: PrFileDiff): Promise<FileContents>
  fetchCurrentBatch(files: PrFileDiff[]): Promise<Map<string, FileContents>>
  fetchBatch(files: PrFileDiff[]): Promise<Map<string, FileContents>>
  resolveRepositoryImage(repositoryPath: string): Promise<string | null>
  fetchRepositoryFile(repositoryPath: string): Promise<string>
}

export function createSelfReviewFileContentLoader(
  options: SelfReviewFileContentLoaderOptions,
): SelfReviewFileContentLoader {
  async function fetch(file: PrFileDiff): Promise<FileContents> {
    return options.getComparisonContents(file.filename) ?? fetchCurrent(file)
  }

  async function fetchCurrent(file: PrFileDiff): Promise<FileContents> {
    const source = createFileContentSource(options, options.getContext())
    return source.fetch({
      path: file.filename,
      oldPath: file.previous_filename ?? null,
      status: file.status,
    })
  }

  async function fetchCurrentBatch(files: PrFileDiff[]): Promise<Map<string, FileContents>> {
    const context = options.getContext()
    const source = createFileContentSource(options, context)
    const requests: FileContentRequest[] = files.map((file) => ({
      path: file.filename,
      oldPath: file.previous_filename ?? null,
      status: file.status,
    }))
    const batchSource = context.selectedCommitSha !== null
      ? 'getCommitBatchFileContents'
      : 'getTaskBatchFileContents'
    const results = await source.fetchBatch(requests)
    if (results.length !== requests.length) {
      throw new Error(
        `${batchSource} response count mismatch: requestCount=${requests.length}, resultCount=${results.length}`,
      )
    }

    return new Map(files.map((file, index) => [file.filename, results[index]!]))
  }

  async function fetchBatch(files: PrFileDiff[]): Promise<Map<string, FileContents>> {
    const contents = new Map<string, FileContents>()
    const currentFiles: PrFileDiff[] = []
    for (const file of files) {
      const comparison = options.getComparisonContents(file.filename)
      if (comparison === undefined) {
        currentFiles.push(file)
      } else {
        contents.set(file.filename, comparison)
      }
    }

    if (currentFiles.length > 0) {
      for (const [filename, currentContents] of await fetchCurrentBatch(currentFiles)) {
        contents.set(filename, currentContents)
      }
    }
    return contents
  }

  async function fetchRepositoryFile(repositoryPath: string): Promise<string> {
    const source = createFileContentSource(options, options.getContext())
    const contents = await source.fetch({
      path: repositoryPath,
      oldPath: null,
      status: 'modified',
    })

    if (contents.newAvailability?.status === 'missing') {
      throw new Error(`Unable to read ${repositoryPath} in the selected review revision.`)
    }
    if (contents.newAvailability?.status === 'too-large') {
      throw new Error(`${repositoryPath} is too large to preview in Review.`)
    }
    if (contents.newAvailability?.status === 'load-failed') {
      throw new Error(`Unable to read ${repositoryPath}: ${contents.newAvailability.message}`)
    }

    return contents.newContent
  }

  async function resolveRepositoryImage(repositoryPath: string): Promise<string | null> {
    const source = createFileContentSource(options, options.getContext())
    const { newContent } = await source.fetch({
      path: repositoryPath,
      oldPath: null,
      status: 'modified',
    })
    return getImagePreviewDataUrl(repositoryPath, newContent)
  }

  return {
    fetch,
    fetchCurrent,
    fetchCurrentBatch,
    fetchBatch,
    fetchRepositoryFile,
    resolveRepositoryImage,
  }
}
