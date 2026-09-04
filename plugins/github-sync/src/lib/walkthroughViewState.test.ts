import { describe, it, expect } from 'vitest'
import { buildSyntheticStepFiles, buildWalkthroughStepList, clampStepIndex, isWalkthroughStale, isPrLargeEnoughForWalkthroughHint, toggleCoverageFinding } from './walkthroughViewState'
import type { PrFileDiff, PrWalkthrough, PrWalkthroughStep, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import type { CoverageFinding } from './ticketCoverage'

function file(filename: string, hunks: number, extra: Partial<PrFileDiff> = {}): PrFileDiff {
  const parts: string[] = []
  let additions = 0
  for (let i = 0; i < hunks; i++) {
    const start = i * 10 + 1
    parts.push(`@@ -${start},1 +${start},2 @@\n a\n+B${i}`)
    additions++
  }
  return {
    sha: 'sha',
    filename,
    status: 'modified',
    additions,
    deletions: 0,
    changes: additions,
    patch: parts.length > 0 ? parts.join('\n') : null,
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    ...extra,
  }
}

function makePr(over: Partial<ReviewPullRequest>): ReviewPullRequest {
  return {
    id: 1,
    number: 1,
    title: 't',
    body: null,
    state: 'open',
    draft: false,
    html_url: '',
    user_login: 'u',
    user_avatar_url: null,
    repo_owner: 'o',
    repo_name: 'r',
    head_ref: 'h',
    base_ref: 'b',
    head_sha: 'sha-current',
    additions: 0,
    deletions: 0,
    changed_files: 0,
    mergeable: null,
    mergeable_state: null,
    created_at: 0,
    updated_at: 0,
    viewed_at: null,
    viewed_head_sha: null,
    labels: [],
    ...over,
  }
}

function makeWalkthrough(over: Partial<PrWalkthrough>): PrWalkthrough {
  return {
    pr_id: 1,
    head_sha: 'sha-current',
    walkthrough_session_key: null,
    status: 'ready',
    steps_json: null,
    error_message: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  }
}

describe('buildSyntheticStepFiles', () => {
  const allFiles = [file('a.ts', 2), file('b.ts', 3), file('c.ts', 1)]

  it('returns empty array for empty step', () => {
    const step: PrWalkthroughStep = { id: 's', title: 't', summary: 's', files: [] }
    expect(buildSyntheticStepFiles(allFiles, step)).toEqual([])
  })

  it('returns the file unchanged when hunk_indexes is null', () => {
    const step: PrWalkthroughStep = {
      id: 's',
      title: 't',
      summary: 's',
      files: [{ filename: 'b.ts', hunk_indexes: null }],
    }
    const out = buildSyntheticStepFiles(allFiles, step)
    expect(out).toHaveLength(1)
    expect(out[0].filename).toBe('b.ts')
    expect(out[0].patch).toBe(allFiles[1].patch)
  })

  it('filters the patch to selected hunks', () => {
    const step: PrWalkthroughStep = {
      id: 's',
      title: 't',
      summary: 's',
      files: [{ filename: 'b.ts', hunk_indexes: [0, 2] }],
    }
    const out = buildSyntheticStepFiles(allFiles, step)
    expect(out[0].patch).toContain('@@ -1,1 +1,2 @@')
    expect(out[0].patch).toContain('+B0')
    expect(out[0].patch).toContain('@@ -21,1 +21,2 @@')
    expect(out[0].patch).toContain('+B2')
    expect(out[0].patch).not.toContain('+B1')
  })

  it('preserves source order across files', () => {
    const step: PrWalkthroughStep = {
      id: 's',
      title: 't',
      summary: 's',
      files: [
        { filename: 'b.ts', hunk_indexes: [0] },
        { filename: 'a.ts', hunk_indexes: [0] },
      ],
    }
    const out = buildSyntheticStepFiles(allFiles, step)
    expect(out.map(f => f.filename)).toEqual(['a.ts', 'b.ts'])
  })

  it('drops a file whose filename does not exist in PR diffs', () => {
    const step: PrWalkthroughStep = {
      id: 's',
      title: 't',
      summary: 's',
      files: [
        { filename: 'ghost.ts', hunk_indexes: null },
        { filename: 'a.ts', hunk_indexes: null },
      ],
    }
    const out = buildSyntheticStepFiles(allFiles, step)
    expect(out.map(f => f.filename)).toEqual(['a.ts'])
  })

  it('drops a file whose selected hunks are all out of range', () => {
    const step: PrWalkthroughStep = {
      id: 's',
      title: 't',
      summary: 's',
      files: [{ filename: 'a.ts', hunk_indexes: [99] }],
    }
    const out = buildSyntheticStepFiles(allFiles, step)
    expect(out).toEqual([])
  })
})

describe('clampStepIndex', () => {
  it('returns 0 when total is 0 regardless of input', () => {
    expect(clampStepIndex(5, 0)).toBe(0)
    expect(clampStepIndex(-1, 0)).toBe(0)
  })

  it('clamps below 0 to 0', () => {
    expect(clampStepIndex(-5, 3)).toBe(0)
  })

  it('clamps above last index to last index', () => {
    expect(clampStepIndex(10, 3)).toBe(2)
  })

  it('returns the input when in range', () => {
    expect(clampStepIndex(1, 3)).toBe(1)
  })
})

describe('isWalkthroughStale', () => {
  it('returns false when walkthrough is null', () => {
    expect(isWalkthroughStale(null, makePr({}))).toBe(false)
  })

  it('returns false when head_sha matches current PR', () => {
    const w = makeWalkthrough({ head_sha: 'sha-current' })
    expect(isWalkthroughStale(w, makePr({ head_sha: 'sha-current' }))).toBe(false)
  })

  it('returns true when PR head_sha has advanced', () => {
    const w = makeWalkthrough({ head_sha: 'sha-old' })
    expect(isWalkthroughStale(w, makePr({ head_sha: 'sha-new' }))).toBe(true)
  })

  it('returns false for a generating walkthrough even if shas match — caller should use status', () => {
    const w = makeWalkthrough({ head_sha: 'sha-current', status: 'generating' })
    expect(isWalkthroughStale(w, makePr({ head_sha: 'sha-current' }))).toBe(false)
  })
})

function walkthroughStep(id: string): PrWalkthroughStep {
  return { id, title: id, summary: id, files: [{ filename: 'a.ts', hunk_indexes: null }] }
}

describe('buildWalkthroughStepList', () => {
  const steps = [walkthroughStep('a'), walkthroughStep('b')]

  it('leads with the ticket step and trails with review/submit', () => {
    // The ticket step is unconditional: when Jira is unconfigured it is what
    // explains why there is no coverage, which is otherwise invisible.
    expect(buildWalkthroughStepList(steps)).toEqual([
      { kind: 'ticket' },
      { kind: 'concept', step: steps[0] },
      { kind: 'concept', step: steps[1] },
      { kind: 'submit' },
    ])
  })

  it('is just the ticket and review/submit steps when there are no parsed steps', () => {
    expect(buildWalkthroughStepList([]).map(entry => entry.kind)).toEqual(['ticket', 'submit'])
  })

  it('keeps the ticket step from shifting which entry is the submit step', () => {
    const entries = buildWalkthroughStepList(steps)
    expect(entries.at(-1)).toEqual({ kind: 'submit' })
    expect(entries[1]).toEqual({ kind: 'concept', step: steps[0] })
  })
})

describe('toggleCoverageFinding', () => {
  const finding = (id: string): CoverageFinding => ({ id, label: 'Partial', text: `gap ${id}` })

  it('adds a finding that is not yet included', () => {
    expect(toggleCoverageFinding([], finding('crit-1'))).toEqual([finding('crit-1')])
  })

  it('appends to existing findings, preserving order', () => {
    const result = toggleCoverageFinding([finding('crit-1')], finding('oos-0'))
    expect(result).toEqual([finding('crit-1'), finding('oos-0')])
  })

  it('removes a finding that is already included, by id', () => {
    const result = toggleCoverageFinding([finding('crit-1'), finding('oos-0')], finding('crit-1'))
    expect(result).toEqual([finding('oos-0')])
  })
})

describe('isPrLargeEnoughForWalkthroughHint', () => {
  it('returns false when below both thresholds', () => {
    const files = [file('a.ts', 1)]
    const pr = makePr({ additions: 10, deletions: 10, changed_files: 1 })
    expect(isPrLargeEnoughForWalkthroughHint(pr, files)).toBe(false)
  })

  it('returns true when changed_files exceeds the file threshold', () => {
    const files = Array.from({ length: 11 }, (_, i) => file(`f${i}.ts`, 1))
    const pr = makePr({ additions: 5, deletions: 5, changed_files: 11 })
    expect(isPrLargeEnoughForWalkthroughHint(pr, files)).toBe(true)
  })

  it('returns true when total LOC changed exceeds the LOC threshold', () => {
    const files = [file('a.ts', 1)]
    const pr = makePr({ additions: 200, deletions: 150, changed_files: 1 })
    expect(isPrLargeEnoughForWalkthroughHint(pr, files)).toBe(true)
  })

  it('uses the files array length when PR.changed_files is 0/missing', () => {
    const files = Array.from({ length: 12 }, (_, i) => file(`f${i}.ts`, 1))
    const pr = makePr({ changed_files: 0 })
    expect(isPrLargeEnoughForWalkthroughHint(pr, files)).toBe(true)
  })
})
