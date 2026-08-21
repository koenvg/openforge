import type { PrFileDiff } from '../../../../lib/types'

export const modifiedFileWithPatch: PrFileDiff = {
  sha: 'abc123',
  filename: 'src/test.ts',
  status: 'modified',
  additions: 2,
  deletions: 1,
  changes: 3,
  patch: '@@ -1,3 +1,4 @@\n line1\n+added\n line2',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

export const addedFileWithPatch: PrFileDiff = {
  sha: 'def456',
  filename: 'src/other.ts',
  status: 'added',
  additions: 5,
  deletions: 0,
  changes: 5,
  patch: '@@ -0,0 +1,5 @@\n+line1\n+line2',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}
