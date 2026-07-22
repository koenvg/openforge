import { describe, expect, it } from 'vitest'

import { DO_NOT_REVIEW_LABEL, hasDoNotReviewLabel, parseCheckRuns, splitCheckRuns } from './domain'

describe('shared domain helpers', () => {
  it('parses and splits check runs for plugin PR views', () => {
    const checks = parseCheckRuns(JSON.stringify([
      { id: 1, name: 'unit', status: 'completed', conclusion: 'success', html_url: 'https://example.com/1' },
      { id: 2, name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/2' },
    ]))

    expect(splitCheckRuns(checks)).toEqual({
      visible: [{ id: 2, name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/2' }],
      passingCount: 1,
    })
  })
})

describe('hasDoNotReviewLabel', () => {
  const withLabels = (...names: string[]) => ({
    labels: names.map((name) => ({ name, color: 'b60205' })),
  })

  it('is true when the DO NOT REVIEW label is present', () => {
    expect(hasDoNotReviewLabel(withLabels('DO NOT REVIEW'))).toBe(true)
    expect(hasDoNotReviewLabel(withLabels('bug', 'DO NOT REVIEW'))).toBe(true)
  })

  it('matches the label case-insensitively and trimmed', () => {
    expect(hasDoNotReviewLabel(withLabels('do not review'))).toBe(true)
    expect(hasDoNotReviewLabel(withLabels('  Do Not Review  '))).toBe(true)
  })

  it('is false when no DO NOT REVIEW label is present', () => {
    expect(hasDoNotReviewLabel(withLabels('bug', 'enhancement'))).toBe(false)
    expect(hasDoNotReviewLabel(withLabels())).toBe(false)
  })

  it('tolerates a missing or null labels field', () => {
    expect(hasDoNotReviewLabel({})).toBe(false)
    expect(hasDoNotReviewLabel({ labels: null })).toBe(false)
    expect(hasDoNotReviewLabel({ labels: undefined })).toBe(false)
  })

  it('exposes the hard-coded label constant', () => {
    expect(DO_NOT_REVIEW_LABEL).toBe('DO NOT REVIEW')
  })
})
