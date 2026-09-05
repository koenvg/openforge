import type { CommitInfo, PrFileDiff } from '../../../src/lib/types'
import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter'

export const reviewFileContents: FileContents = {
  oldContent: 'export function greet(name: string) {\n  return `Hello ${name}`\n}\n',
  newContent: 'export function greet(name: string) {\n  return `Hello, ${name.trim()}!`\n}\n',
}

export function createReviewDiff(filename = 'src/greet.ts'): PrFileDiff {
  return {
    sha: 'abc123', filename, status: 'modified', additions: 1, deletions: 1, changes: 2,
    patch: '@@ -1,3 +1,3 @@\n export function greet(name: string) {\n-  return `Hello ${name}`\n+  return `Hello, ${name.trim()}!`\n }',
    previous_filename: null, is_truncated: false, patch_line_count: 5,
  }
}

export function createReviewCommit(): CommitInfo {
  return {
    sha: 'abc123', short_sha: 'abc123', message: 'Normalize the greeting',
    author: 'Alex', date: '2026-01-02T09:25:00.000Z',
  }
}
