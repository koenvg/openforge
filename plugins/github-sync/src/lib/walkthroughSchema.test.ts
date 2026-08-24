import { describe, expect, it } from 'vitest'
import {
  WALKTHROUGH_REVIEW_JSON_SCHEMA,
  WALKTHROUGH_REVIEW_TICKET_JSON_SCHEMA,
} from './walkthroughSchema'

function parse(schema: string): Record<string, any> {
  return JSON.parse(schema)
}

describe('WALKTHROUGH_REVIEW_JSON_SCHEMA', () => {
  it('requires the steps and review comments the walkthrough has always produced', () => {
    expect(parse(WALKTHROUGH_REVIEW_JSON_SCHEMA).required).toEqual(['steps', 'review_comments'])
  })

  it('never mentions ticket coverage, so the no-Jira path is unchanged', () => {
    // A PR with no resolvable ticket must get exactly the prompt and schema it
    // got before this feature existed.
    expect(WALKTHROUGH_REVIEW_JSON_SCHEMA).not.toContain('ticket_coverage')
  })
})

describe('WALKTHROUGH_REVIEW_TICKET_JSON_SCHEMA', () => {
  const schema = parse(WALKTHROUGH_REVIEW_TICKET_JSON_SCHEMA)

  it('additionally requires ticket coverage', () => {
    expect(schema.required).toEqual(['steps', 'review_comments', 'ticket_coverage'])
  })

  it('keeps the steps and review_comments contract identical to the base schema', () => {
    const base = parse(WALKTHROUGH_REVIEW_JSON_SCHEMA)
    expect(schema.properties.steps).toEqual(base.properties.steps)
    expect(schema.properties.review_comments).toEqual(base.properties.review_comments)
  })

  it('constrains the verdict and per-criterion status to the values the parser accepts', () => {
    const coverage = schema.properties.ticket_coverage
    expect(coverage.properties.verdict.enum).toEqual([
      'complete', 'partial', 'missing', 'unassessable',
    ])
    expect(coverage.properties.criteria.items.properties.status.enum).toEqual([
      'covered', 'partial', 'missing', 'unclear',
    ])
  })

  it('requires each criterion to carry the fields the UI renders', () => {
    const criterion = schema.properties.ticket_coverage.properties.criteria.items
    expect(criterion.required).toEqual(['id', 'text', 'status'])
  })

  it('describes out_of_scope entries', () => {
    const outOfScope = schema.properties.ticket_coverage.properties.out_of_scope
    expect(outOfScope.items.required).toEqual(['description'])
  })
})
