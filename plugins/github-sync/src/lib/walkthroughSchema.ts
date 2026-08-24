// JSON Schema handed to `claude --json-schema` so the combined walkthrough +
// review generation returns a validated object. Kept in sync with
// parseAndValidateWalkthroughSteps + parseAndValidateReviewComments (both of
// which still re-validate against the live diff — the schema shapes output, the
// parsers enforce diff-truth).
const STEPS_AND_REVIEW_PROPERTIES = {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'summary', 'files'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              required: ['filename'],
              properties: {
                filename: { type: 'string' },
                hunk_indexes: { type: ['array', 'null'], items: { type: 'integer' } },
              },
            },
          },
        },
      },
    },
    review_comments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['filename', 'line', 'side', 'body'],
        properties: {
          filename: { type: 'string' },
          line: { type: 'integer' },
          side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
          body: { type: 'string' },
          kind: { type: 'string', enum: ['question', 'suggestion', 'note'] },
        },
      },
    },
} as const

export const WALKTHROUGH_REVIEW_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['steps', 'review_comments'],
  properties: STEPS_AND_REVIEW_PROPERTIES,
})

// Enum values are duplicated as literals rather than imported from
// ticketCoverage.ts so this stays a plain JSON-schema document; the schema test
// locks them to the values parseAndValidateTicketCoverage accepts.
const TICKET_COVERAGE_PROPERTY = {
  type: 'object',
  required: ['verdict', 'summary', 'criteria'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['complete', 'partial', 'missing', 'unassessable'],
    },
    summary: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'text', 'status'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          status: {
            type: 'string',
            enum: ['covered', 'partial', 'missing', 'unclear'],
          },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              required: ['filename'],
              properties: {
                filename: { type: 'string' },
                note: { type: 'string' },
              },
            },
          },
          notes: { type: 'string' },
        },
      },
    },
    out_of_scope: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description'],
        properties: {
          description: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const

/**
 * Used in place of the base schema when a Jira ticket was resolved for the PR.
 * Splitting the two rather than making `ticket_coverage` optional keeps the
 * no-ticket path byte-identical to what it was before the gap analysis existed.
 */
export const WALKTHROUGH_REVIEW_TICKET_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['steps', 'review_comments', 'ticket_coverage'],
  properties: {
    ...STEPS_AND_REVIEW_PROPERTIES,
    ticket_coverage: TICKET_COVERAGE_PROPERTY,
  },
})
