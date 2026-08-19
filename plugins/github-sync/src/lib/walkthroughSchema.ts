// JSON Schema handed to `claude --json-schema` so the combined walkthrough +
// review generation returns a validated object. Kept in sync with
// parseAndValidateWalkthroughSteps + parseAndValidateReviewComments (both of
// which still re-validate against the live diff — the schema shapes output, the
// parsers enforce diff-truth).
export const WALKTHROUGH_REVIEW_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['steps', 'review_comments'],
  properties: {
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
  },
})
