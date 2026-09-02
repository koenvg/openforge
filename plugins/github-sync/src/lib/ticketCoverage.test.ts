import { describe, it, expect } from 'vitest'
import {
  criterionFinding,
  outOfScopeFinding,
  type CoverageCriterion,
  type OutOfScopeChange,
} from './ticketCoverage'

const criterion = (overrides: Partial<CoverageCriterion> = {}): CoverageCriterion => ({
  id: 'crit-1',
  text: 'Show a confirmation dialog before delete',
  status: 'missing',
  evidence: [],
  notes: null,
  ...overrides,
})

const outOfScope = (overrides: Partial<OutOfScopeChange> = {}): OutOfScopeChange => ({
  description: 'refactored the logging module',
  files: [],
  ...overrides,
})

describe('criterionFinding', () => {
  it('attributes a gap to the Jira ticket and contrasts it with the notes', () => {
    const finding = criterionFinding(criterion({ status: 'missing', notes: 'the dialog has no cancel button' }))
    expect(finding.text).toBe(
      'Jira ticket mentions "Show a confirmation dialog before delete", but the dialog has no cancel button',
    )
  })

  it('joins a covered criterion with "and" instead of "but"', () => {
    const finding = criterionFinding(criterion({ status: 'covered', notes: 'it is added in Foo.svelte' }))
    expect(finding.text).toBe(
      'Jira ticket mentions "Show a confirmation dialog before delete", and it is added in Foo.svelte',
    )
  })

  it('omits the contrast clause when the criterion has no notes', () => {
    const finding = criterionFinding(criterion({ status: 'partial', notes: null }))
    expect(finding.text).toBe('Jira ticket mentions "Show a confirmation dialog before delete"')
  })

  it('carries the criterion id and status label', () => {
    const finding = criterionFinding(criterion({ id: 'crit-9', status: 'partial' }))
    expect(finding.id).toBe('crit-9')
    expect(finding.label).toBe('Partial')
  })
})

describe('outOfScopeFinding', () => {
  it('marks the change as outside the Jira ticket', () => {
    const finding = outOfScopeFinding(outOfScope({ description: 'refactored the logging module' }), 0)
    expect(finding).toEqual({
      id: 'oos-0',
      label: 'Not in the ticket',
      text: 'Not in the Jira ticket, but changed by this PR: refactored the logging module',
    })
  })

  it('keys the finding id by its index', () => {
    expect(outOfScopeFinding(outOfScope(), 3).id).toBe('oos-3')
  })
})
