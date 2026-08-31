import { describe, expect, it } from 'vitest'

import { countNonApplicationFiles, filterApplicationFiles, isNonApplicationFile } from '@openforge-app/pr-review-ui/applicationFiles'
import { toGitDiffViewData } from '@openforge-app/pr-review-ui/diffAdapter'
import { prCommentsToReviewComments } from '@openforge-app/pr-review-ui/diffComments'
import { configureDiffHighlighter } from '@openforge-app/pr-review-ui/diffHighlightConfig'
import { diffHighlighter } from '@openforge-app/pr-review-ui/diffHighlighter'
import { countMatchesInPatch } from '@openforge-app/pr-review-ui/diffSearch'
import type { DiffWorkerRequest, DiffWorkerResponse } from '@openforge-app/pr-review-ui/diffWorker'
import { sortFilesAsTree } from '@openforge-app/pr-review-ui/fileSort'
import { getReviewFileIdentity } from '@openforge-app/pr-review-ui/reviewFileIdentity'
import { createDiffSearch } from '@openforge-app/pr-review-ui/useDiffSearch.svelte'
import { createDiffWorker } from '@openforge-app/pr-review-ui/useDiffWorker.svelte'
import { createFileContentsFetcher } from '@openforge-app/pr-review-ui/useFileContentsFetcher.svelte'
import { createVirtualizer } from '@openforge-app/pr-review-ui/useVirtualizer.svelte'
import type { ReviewMediaOpenRequest } from '@openforge-app/pr-review-ui/reviewMedia'

/**
 * Keeps shared diff helper subpath exports intentional. The host app and bundled
 * plugins must import these helpers from @openforge-app/pr-review-ui instead of
 * carrying duplicated src/lib copies.
 */
describe('@openforge-app/pr-review-ui diff helper exports', () => {
  it('exposes the shared diff utility entrypoints consumed by host and plugins', () => {
    expect(isNonApplicationFile).toBeTypeOf('function')
    expect(countNonApplicationFiles).toBeTypeOf('function')
    expect(filterApplicationFiles).toBeTypeOf('function')
    expect(toGitDiffViewData).toBeTypeOf('function')
    expect(prCommentsToReviewComments).toBeTypeOf('function')
    expect(configureDiffHighlighter).toBeTypeOf('function')
    expect(diffHighlighter).toBeDefined()
    expect(countMatchesInPatch).toBeTypeOf('function')
    expect(sortFilesAsTree).toBeTypeOf('function')
    expect(getReviewFileIdentity).toBeTypeOf('function')
    expect(createDiffSearch).toBeTypeOf('function')
    expect(createDiffWorker).toBeTypeOf('function')
    expect(createFileContentsFetcher).toBeTypeOf('function')
    expect(createVirtualizer).toBeTypeOf('function')
  })

  it('exports diff worker request and response types', () => {
    const request = {
      type: 'process',
      id: 'file.ts',
      data: {
        oldFile: { fileName: 'file.ts', fileLang: 'typescript', content: null },
        newFile: { fileName: 'file.ts', fileLang: 'typescript', content: null },
        hunks: [],
      },
      theme: 'dark',
    } satisfies DiffWorkerRequest
    const response = { type: 'error', id: 'file.ts', error: 'failed' } satisfies DiffWorkerResponse

    expect(request.type).toBe('process')
    expect(response.type).toBe('error')
  })

  it('exports a discriminated image and video review media contract', () => {
    const request = {
      items: [
        { kind: 'image', src: 'data:image/png;base64,a', alt: 'Before logo', filename: 'logo.png', label: 'Before' },
        { kind: 'video', src: 'data:video/mp4;base64,b', alt: 'After demo', filename: 'demo.mp4', label: 'After' },
      ],
      activeIndex: 1,
    } satisfies ReviewMediaOpenRequest

    expect(request.items[request.activeIndex]?.kind).toBe('video')
  })
})
