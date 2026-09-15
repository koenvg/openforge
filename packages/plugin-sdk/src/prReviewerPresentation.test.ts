import { describe, expect, it } from 'vitest'
import { getPrReviewerRows } from '@openforge-app/plugin-sdk/prStatusPresentation'
import type { PrReviewer } from '@openforge-app/plugin-sdk/domain'

describe('getPrReviewerRows', () => {
  const reviewer = (login: string, state: PrReviewer['state'], kind: PrReviewer['kind'] = 'user'): PrReviewer =>
    ({ login, kind, state })

  it('orders reviewers who hold the pull request before reviewers who do not', () => {
    const rows = getPrReviewerRows({
      reviewers: [
        reviewer('alice', 'approved'),
        reviewer('bob', 'commented'),
        reviewer('carol', 'pending'),
        reviewer('dave', 'changes_requested'),
      ],
    })

    expect(rows.map((row) => row.login)).toEqual(['dave', 'carol', 'bob', 'alice'])
  })

  it('keeps reviewers with the same verdict in the order they arrived', () => {
    const rows = getPrReviewerRows({
      reviewers: [reviewer('alice', 'pending'), reviewer('platform', 'pending', 'team')],
    })

    expect(rows.map((row) => row.login)).toEqual(['alice', 'platform'])
  })

  it('labels every verdict', () => {
    const rows = getPrReviewerRows({
      reviewers: [
        reviewer('dave', 'changes_requested'),
        reviewer('carol', 'pending'),
        reviewer('bob', 'commented'),
        reviewer('erin', 'dismissed'),
        reviewer('alice', 'approved'),
      ],
    })

    expect(rows.map((row) => [row.login, row.label, row.status])).toEqual([
      ['dave', 'Changes requested', 'failed'],
      ['carol', 'Pending', 'pending'],
      ['bob', 'Commented', 'in-review'],
      ['erin', 'Dismissed', 'expired'],
      ['alice', 'Approved', 'success'],
    ])
  })

  it('reads the stored JSON form the sidecar sends', () => {
    const rows = getPrReviewerRows({
      reviewers: JSON.stringify([reviewer('platform', 'pending', 'team')]),
    })

    expect(rows).toEqual([
      expect.objectContaining({ login: 'platform', kind: 'team', state: 'pending', label: 'Pending' }),
    ])
  })

  it('names a team so it cannot be mistaken for a person', () => {
    const [row] = getPrReviewerRows({ reviewers: [reviewer('platform', 'pending', 'team')] })

    expect(row.name).toBe('platform (team)')
  })

  it('names a person and a bot by their login alone', () => {
    const rows = getPrReviewerRows({
      reviewers: [reviewer('alice', 'approved'), reviewer('copilot[bot]', 'commented', 'bot')],
    })

    expect(rows.map((row) => row.name)).toEqual(['copilot[bot]', 'alice'])
  })

  it('has no rows when nobody reviewed and nobody was asked', () => {
    expect(getPrReviewerRows({ reviewers: null })).toEqual([])
    expect(getPrReviewerRows({ reviewers: undefined })).toEqual([])
    expect(getPrReviewerRows({ reviewers: '' })).toEqual([])
    expect(getPrReviewerRows({ reviewers: [] })).toEqual([])
  })

  it('has no rows when the stored field cannot be read', () => {
    expect(getPrReviewerRows({ reviewers: 'not json' })).toEqual([])
    expect(getPrReviewerRows({ reviewers: '{"login":"alice"}' })).toEqual([])
    expect(getPrReviewerRows({ reviewers: '[{"login":"alice"}]' })).toEqual([])
    expect(getPrReviewerRows({ reviewers: '[{"login":"alice","kind":"user","state":"nonsense"}]' })).toEqual([])
  })
})
