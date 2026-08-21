import { getImagePreviewDataUrl, type FileContents } from '@openforge-app/pr-review-ui/diffAdapter'
import type { PrFileDiff } from './types'

export interface SelfReviewContext {
  taskId: string
  selectedCommitSha: string | null
  includeCommitted: boolean
  includeUncommitted: boolean
}

export interface SelfReviewFileContentLoaderOptions {
  getContext: () => SelfReviewContext
  getComparisonContents: (filename: string) => FileContents | undefined
  getTaskFileContents: (
    taskId: string,
    path: string,
    oldPath: string | null,
    status: string,
    includeCommitted: boolean,
    includeUncommitted: boolean,
  ) => Promise<[string, string]>
  getTaskBatchFileContents: (
    taskId: string,
    files: Array<{ path: string; oldPath: string | null; status: string }>,
    includeCommitted: boolean,
    includeUncommitted: boolean,
  ) => Promise<Array<[string, string]>>
  getCommitFileContents: (
    taskId: string,
    commitSha: string,
    path: string,
    oldPath: string | null,
    status: string,
  ) => Promise<[string, string]>
  getCommitBatchFileContents: (
    taskId: string,
    commitSha: string,
    files: Array<{ path: string; oldPath: string | null; status: string }>,
  ) => Promise<Array<[string, string]>>
}

export interface SelfReviewFileContentLoader {
  fetch(file: PrFileDiff): Promise<FileContents>
  fetchCurrent(file: PrFileDiff): Promise<FileContents>
  fetchCurrentBatch(files: PrFileDiff[]): Promise<Map<string, FileContents>>
  fetchBatch(files: PrFileDiff[]): Promise<Map<string, FileContents>>
  resolveRepositoryImage(repositoryPath: string): Promise<string | null>
}

export function createSelfReviewFileContentLoader(
  options: SelfReviewFileContentLoaderOptions,
): SelfReviewFileContentLoader {
  async function fetch(file: PrFileDiff): Promise<FileContents> {
    return options.getComparisonContents(file.filename) ?? fetchCurrent(file)
  }

  async function fetchCurrent(file: PrFileDiff): Promise<FileContents> {
    const context = options.getContext()
    const [oldContent, newContent] = context.selectedCommitSha !== null
      ? await options.getCommitFileContents(
          context.taskId,
          context.selectedCommitSha,
          file.filename,
          file.previous_filename,
          file.status,
        )
      : await options.getTaskFileContents(
          context.taskId,
          file.filename,
          file.previous_filename,
          file.status,
          context.includeCommitted,
          context.includeUncommitted,
        )
    return { oldContent, newContent }
  }

  async function fetchCurrentBatch(files: PrFileDiff[]): Promise<Map<string, FileContents>> {
    const context = options.getContext()
    const requests = files.map((file) => ({
      path: file.filename,
      oldPath: file.previous_filename ?? null,
      status: file.status,
    }))
    const results = context.selectedCommitSha !== null
      ? await options.getCommitBatchFileContents(context.taskId, context.selectedCommitSha, requests)
      : await options.getTaskBatchFileContents(
          context.taskId,
          requests,
          context.includeCommitted,
          context.includeUncommitted,
        )

    return new Map(files.map((file, index) => {
      const [oldContent, newContent] = results[index]!
      return [file.filename, { oldContent, newContent }]
    }))
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

  async function resolveRepositoryImage(repositoryPath: string): Promise<string | null> {
    const context = options.getContext()
    const [, content] = context.selectedCommitSha !== null
      ? await options.getCommitFileContents(
          context.taskId,
          context.selectedCommitSha,
          repositoryPath,
          null,
          'modified',
        )
      : await options.getTaskFileContents(
          context.taskId,
          repositoryPath,
          null,
          'modified',
          context.includeCommitted,
          context.includeUncommitted,
        )
    return getImagePreviewDataUrl(repositoryPath, content)
  }

  return { fetch, fetchCurrent, fetchCurrentBatch, fetchBatch, resolveRepositoryImage }
}
