import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect } from 'vitest'
import ReviewPrCard from './ReviewPrCard.svelte'
import type { ReviewPullRequest } from '@openforge/plugin-sdk/domain'

const basePr: ReviewPullRequest = {
  id: 12345,
  number: 42,
  title: 'Fix authentication middleware',
  body: 'This PR fixes the auth middleware',
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/repo/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'fix/auth',
  base_ref: 'main',
  head_sha: 'abc123',
  additions: 50,
  deletions: 10,
  changed_files: 3,
  mergeable: null,
  mergeable_state: null,
  created_at: Date.now() - 3600000,
  updated_at: Date.now(),
  viewed_at: null,
  viewed_head_sha: null,
  labels: [],
}

describe('ReviewPrCard', () => {
  it('renders PR title', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('Fix authentication middleware')).toBeTruthy()
  })

  it('renders PR number with # prefix', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('#42')).toBeTruthy()
  })

  it('renders repo badge with owner and name', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('acme/repo')).toBeTruthy()
  })

  it('renders author username', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('alice')).toBeTruthy()
  })

  it('shows draft badge when pr.draft is true', () => {
    const draftPr = { ...basePr, draft: true }
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: draftPr, selected: false, onClick } })
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('hides draft badge when pr.draft is false', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.queryByText('Draft')).toBeNull()
  })

  it('shows additions count with + prefix', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('+50')).toBeTruthy()
  })

  it('shows deletions count with − prefix', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('−10')).toBeTruthy()
  })

  it('shows file count with singular label for 1 file', () => {
    const singleFilePr = { ...basePr, changed_files: 1 }
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: singleFilePr, selected: false, onClick } })
    expect(screen.getByText('1 file')).toBeTruthy()
  })

  it('shows file count with plural label for multiple files', () => {
    const onClick = () => {}
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    expect(screen.getByText('3 files')).toBeTruthy()
  })

  it('shows Merge Conflict badge when the PR cannot merge cleanly', () => {
    const onClick = () => {}
    const conflictedPr = { ...basePr, mergeable: false, mergeable_state: 'dirty', state: 'open' }
    render(ReviewPrCard, { props: { pr: conflictedPr, selected: false, onClick } })
    expect(screen.getByText('Merge Conflict')).toBeTruthy()
  })

  it('calls onClick when card is clicked', async () => {
    let clicked = false
    const onClick = () => {
      clicked = true
    }
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick } })
    const card = screen.getByRole('button')
    await fireEvent.click(card)
    expect(clicked).toBe(true)
  })

  it('renders each label name when the PR has labels', () => {
    const labeledPr = {
      ...basePr,
      labels: [
        { name: 'DO NOT REVIEW', color: 'b60205' },
        { name: 'bug', color: 'd73a4a' },
      ],
    }
    render(ReviewPrCard, { props: { pr: labeledPr, selected: false, onClick: () => {} } })
    expect(screen.getByText('DO NOT REVIEW')).toBeTruthy()
    expect(screen.getByText('bug')).toBeTruthy()
  })

  it('renders no label badges when the PR has no labels', () => {
    render(ReviewPrCard, { props: { pr: basePr, selected: false, onClick: () => {} } })
    expect(screen.queryByText('DO NOT REVIEW')).toBeNull()
  })

  it('caps visible labels at 4 and shows a +k overflow indicator', () => {
    const manyLabels = [
      { name: 'one', color: '000000' },
      { name: 'two', color: '000000' },
      { name: 'three', color: '000000' },
      { name: 'four', color: '000000' },
      { name: 'five', color: '000000' },
      { name: 'six', color: '000000' },
    ]
    const labeledPr = { ...basePr, labels: manyLabels }
    render(ReviewPrCard, { props: { pr: labeledPr, selected: false, onClick: () => {} } })
    expect(screen.getByText('one')).toBeTruthy()
    expect(screen.getByText('four')).toBeTruthy()
    expect(screen.queryByText('five')).toBeNull()
    expect(screen.queryByText('six')).toBeNull()
    // 6 labels, 4 shown -> 2 hidden
    expect(screen.getByText('+2')).toBeTruthy()
  })

})
