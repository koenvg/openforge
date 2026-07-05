import { describe, it, expect } from 'vitest'
import { compileWalkthroughPrompt } from './walkthroughPrompt'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'

function makeFile(over: Partial<PrFileDiff>): PrFileDiff {
  return {
    sha: 'sha',
    filename: 'a.ts',
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: null,
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    ...over,
  }
}

describe('compileWalkthroughPrompt', () => {
  it('includes the PR title', () => {
    const out = compileWalkthroughPrompt({
      title: 'Add user_id to sessions',
      body: null,
      files: [],
    })
    expect(out).toContain('Add user_id to sessions')
  })

  it('includes the PR body when present', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: 'This PR introduces a new column to track session ownership.',
      files: [],
    })
    expect(out).toContain('introduces a new column')
  })

  it('omits a body section when body is null', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: null,
      files: [],
    })
    expect(out).not.toContain('Description')
  })

  it('omits a body section when body is empty/whitespace', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: '   \n  ',
      files: [],
    })
    expect(out).not.toContain('Description')
  })

  it('lists each file with status, filename, and per-hunk indexes', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: null,
      files: [
        makeFile({
          filename: 'src/foo.ts',
          status: 'modified',
          additions: 5,
          deletions: 2,
          patch: `@@ -1,1 +1,2 @@
 a
+B
@@ -10,1 +10,1 @@
-c
+C`,
        }),
      ],
    })
    expect(out).toContain('src/foo.ts')
    expect(out).toContain('modified')
    expect(out).toContain('+5/-2')
    expect(out).toContain('hunk_index: 0')
    expect(out).toContain('hunk_index: 1')
  })

  it('marks added/removed/renamed files distinctly', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: null,
      files: [
        makeFile({ filename: 'new.ts', status: 'added', patch: '@@ -0,0 +1,1 @@\n+x' }),
        makeFile({ filename: 'old.ts', status: 'removed', patch: '@@ -1,1 +0,0 @@\n-x' }),
        makeFile({
          filename: 'renamed.ts',
          previous_filename: 'oldname.ts',
          status: 'renamed',
          patch: null,
        }),
      ],
    })
    expect(out).toContain('added')
    expect(out).toContain('removed')
    expect(out).toContain('renamed')
    expect(out).toContain('oldname.ts → renamed.ts')
  })

  it('notes when a file diff was truncated by the backend', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: null,
      files: [
        makeFile({
          filename: 'big.ts',
          status: 'modified',
          patch: '@@ -1,1 +1,1 @@\n-a\n+A',
          is_truncated: true,
          patch_line_count: 4000,
        }),
      ],
    })
    expect(out).toContain('truncated')
  })

  it('asks for a JSON object with steps[] containing id/title/summary/files', () => {
    const out = compileWalkthroughPrompt({ title: 't', body: null, files: [] })
    expect(out).toContain('"steps"')
    expect(out).toContain('"id"')
    expect(out).toContain('"title"')
    expect(out).toContain('"summary"')
    expect(out).toContain('"files"')
    expect(out).toContain('"hunk_indexes"')
  })

  it('instructs the agent to slice changes by concept, not by file', () => {
    const out = compileWalkthroughPrompt({ title: 't', body: null, files: [] })
    expect(out.toLowerCase()).toContain('concept')
  })

  it('instructs that hunk_indexes must be valid 0-based indexes for that file', () => {
    const out = compileWalkthroughPrompt({ title: 't', body: null, files: [] })
    expect(out.toLowerCase()).toContain('0-based')
  })
})
