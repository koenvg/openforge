import { invokeDesktopCommand as invoke } from '../desktopIpc'
import type { CommitInfo, FileContent, FileEntry, GitStatusSummary, PrFileDiff } from '../types'

export async function getTaskDiff(taskId: string, includeCommitted: boolean, includeUncommitted: boolean): Promise<PrFileDiff[]> {
  return invoke<PrFileDiff[]>("get_task_diff", { taskId, includeCommitted, includeUncommitted });
}

export async function getTaskGitStatus(taskId: string): Promise<GitStatusSummary> {
  return invoke<GitStatusSummary>("get_task_git_status", { taskId });
}

export async function getTaskFileContents(taskId: string, path: string, oldPath: string | null, status: string, includeCommitted: boolean, includeUncommitted: boolean): Promise<[string, string]> {
  return invoke<[string, string]>("get_task_file_contents", { taskId, path, oldPath, status, includeCommitted, includeUncommitted });
}

export interface FileContentRequest {
  path: string;
  oldPath: string | null;
  status: string;
}

export async function getTaskBatchFileContents(taskId: string, files: FileContentRequest[], includeCommitted: boolean, includeUncommitted: boolean): Promise<[string, string][]> {
  return invoke<[string, string][]>("get_task_batch_file_contents", { taskId, files: files.map(f => ({ path: f.path, old_path: f.oldPath, status: f.status })), includeCommitted, includeUncommitted });
}

export async function getTaskCommits(taskId: string): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("get_task_commits", { taskId });
}

export async function getCommitDiff(taskId: string, commitSha: string): Promise<PrFileDiff[]> {
  return invoke<PrFileDiff[]>("get_commit_diff", { taskId, commitSha });
}

export async function getCommitFileContents(taskId: string, commitSha: string, path: string, oldPath: string | null, status: string): Promise<[string, string]> {
  return invoke<[string, string]>("get_commit_file_contents", { taskId, commitSha, path, oldPath, status });
}

export async function getCommitBatchFileContents(taskId: string, commitSha: string, files: FileContentRequest[]): Promise<[string, string][]> {
  return invoke<[string, string][]>("get_commit_batch_file_contents", { taskId, commitSha, files: files.map(f => ({ path: f.path, old_path: f.oldPath, status: f.status })) });
}

export async function searchOpenCodeFiles(projectId: string, query: string): Promise<string[]> {
  return invoke<string[]>("search_opencode_files", { projectId, query });
}

export async function fsReadDir(projectId: string, dirPath: string | null): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("fs_read_dir", { projectId, dirPath });
}

export async function fsReadFile(projectId: string, filePath: string): Promise<FileContent> {
  return invoke<FileContent>("fs_read_file", { projectId, filePath });
}

export async function fsWriteFile(projectId: string, filePath: string, content: string): Promise<void> {
  return invoke<void>("fs_write_file", { projectId, filePath, content });
}

export async function fsSearchFiles(projectId: string, query: string, limit: number = 50): Promise<string[]> {
  return invoke<string[]>("fs_search_files", { projectId, query, limit });
}
