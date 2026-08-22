import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { createDiffFileCollapse } from './useDiffFileCollapse.svelte'

function makeFile(
  filename: string,
  overrides: Partial<PrFileDiff> = {},
): PrFileDiff {
  return {
    sha: `sha-${filename}`,
    filename,
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: '@@ -1 +1 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    ...overrides,
  }
}

describe('createDiffFileCollapse', () => {
  it('auto-collapses large and truncated files on the first non-empty load', async () => {
    const props = $state({ files: [] as PrFileDiff[] })
    let collapse!: ReturnType<typeof createDiffFileCollapse>
    const cleanup = $effect.root(() => {
      collapse = createDiffFileCollapse({
        getFiles: () => props.files,
        getReviewedFileIdentities: () => new Map(),
        getFileReviewIdentity: file => file.sha,
        getOnToggleFileReviewed: () => undefined,
      })
    })

    props.files = [
      makeFile('small.ts'),
      makeFile('large.ts', { additions: 501, changes: 501 }),
      makeFile('truncated.ts', { is_truncated: true }),
    ]
    await tick()

    expect(collapse.collapsedFiles).toEqual(new Set(['large.ts', 'truncated.ts']))

    collapse.toggleCollapse('large.ts')
    props.files = [...props.files, makeFile('later-large.ts', { deletions: 600, changes: 600 })]
    await tick()

    expect(collapse.collapsedFiles).toEqual(new Set(['truncated.ts']))
    cleanup()
  })

  it('supports manual collapse toggles and explicit uncollapse requests', async () => {
    const file = makeFile('manual.ts')
    let collapse!: ReturnType<typeof createDiffFileCollapse>
    const cleanup = $effect.root(() => {
      collapse = createDiffFileCollapse({
        getFiles: () => [file],
        getReviewedFileIdentities: () => new Map(),
        getFileReviewIdentity: currentFile => currentFile.sha,
        getOnToggleFileReviewed: () => undefined,
      })
    })
    await tick()

    collapse.toggleCollapse(file.filename)
    expect(collapse.collapsedFiles).toEqual(new Set([file.filename]))

    collapse.toggleCollapse(file.filename)
    expect(collapse.collapsedFiles).toEqual(new Set())

    collapse.toggleCollapse(file.filename)
    collapse.uncollapseFile(file.filename)
    expect(collapse.collapsedFiles).toEqual(new Set())
    cleanup()
  })

  it('tracks reviewed identity transitions and expands stale reviewed files', async () => {
    const filename = 'reviewed.ts'
    const props = $state({
      files: [makeFile(filename, { sha: 'sha-1' })],
      reviewedFileIdentities: new Map([[filename, 'sha-1']]),
    })
    let collapse!: ReturnType<typeof createDiffFileCollapse>
    const cleanup = $effect.root(() => {
      collapse = createDiffFileCollapse({
        getFiles: () => props.files,
        getReviewedFileIdentities: () => props.reviewedFileIdentities,
        getFileReviewIdentity: file => file.sha,
        getOnToggleFileReviewed: () => undefined,
      })
    })
    await tick()

    expect(collapse.isFileReviewed(props.files[0])).toBe(true)
    expect(collapse.collapsedFiles).toEqual(new Set([filename]))

    props.files = [makeFile(filename, { sha: 'sha-2' })]
    await tick()

    expect(collapse.isFileReviewed(props.files[0])).toBe(false)
    expect(collapse.collapsedFiles).toEqual(new Set())

    props.reviewedFileIdentities = new Map([[filename, 'sha-2']])
    await tick()

    expect(collapse.isFileReviewed(props.files[0])).toBe(true)
    expect(collapse.collapsedFiles).toEqual(new Set([filename]))
    cleanup()
  })

  it('collapses reviewed files and expands files marked unreviewed', async () => {
    const file = makeFile('changed-review.ts')
    const onToggleFileReviewed = vi.fn()
    let collapse!: ReturnType<typeof createDiffFileCollapse>
    const cleanup = $effect.root(() => {
      collapse = createDiffFileCollapse({
        getFiles: () => [file],
        getReviewedFileIdentities: () => new Map(),
        getFileReviewIdentity: currentFile => currentFile.sha,
        getOnToggleFileReviewed: () => onToggleFileReviewed,
      })
    })
    await tick()

    collapse.handleReviewedChange(file, true)
    expect(onToggleFileReviewed).toHaveBeenLastCalledWith(file, true)
    expect(collapse.collapsedFiles).toEqual(new Set([file.filename]))

    collapse.handleReviewedChange(file, false)
    expect(onToggleFileReviewed).toHaveBeenLastCalledWith(file, false)
    expect(collapse.collapsedFiles).toEqual(new Set())
    cleanup()
  })
})
