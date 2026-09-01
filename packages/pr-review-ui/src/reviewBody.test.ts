import { describe, it, expect } from 'vitest'
import { composeReviewBody, type IncludedFinding } from './reviewBody'

const finding = (overrides: Partial<IncludedFinding> = {}): IncludedFinding => ({
  id: 'crit-1',
  label: 'Partial',
  text: '"Eligible domains" → "Domains for review asset", its tooltip dropped',
  ...overrides,
})

describe('composeReviewBody', () => {
  it('returns the trimmed summary unchanged when there are no included findings', () => {
    expect(composeReviewBody([], '  Looks good overall.  ')).toBe('Looks good overall.')
  })

  it('returns an empty string when there are no findings and no summary', () => {
    expect(composeReviewBody([], '')).toBe('')
  })

  it('renders a single finding as a bulleted block ahead of the typed summary', () => {
    const body = composeReviewBody([finding()], 'Otherwise looks solid.')
    expect(body).toBe(
      'Ticket coverage gaps:\n- **Partial**: "Eligible domains" → "Domains for review asset", its tooltip dropped\n\nOtherwise looks solid.'
    )
  })

  it('renders the findings block alone when the summary is empty', () => {
    const body = composeReviewBody([finding()], '')
    expect(body).toBe(
      'Ticket coverage gaps:\n- **Partial**: "Eligible domains" → "Domains for review asset", its tooltip dropped'
    )
  })

  it('renders multiple findings as separate bullets in order', () => {
    const body = composeReviewBody(
      [finding({ id: 'crit-1', label: 'Partial', text: 'first gap' }), finding({ id: 'oos-0', label: 'Not in the ticket', text: 'second gap' })],
      ''
    )
    expect(body).toBe('Ticket coverage gaps:\n- **Partial**: first gap\n- **Not in the ticket**: second gap')
  })
})
