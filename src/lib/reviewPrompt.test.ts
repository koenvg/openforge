import { describe, expect, it } from 'vitest'
import { compileReviewPrompt } from './reviewPrompt'

const prComment = {
  body: 'Fix naming',
  author: 'alice',
  file_path: 'src/utils.ts',
  line_number: 42,
}

describe('compileReviewPrompt', () => {
  it('returns an empty string when there are no comments', () => {
    expect(compileReviewPrompt('address', [])).toBe('')
    expect(compileReviewPrompt('analyze', [], [])).toBe('')
  })

  it('does not include the task initial prompt', () => {
    const result = compileReviewPrompt('address', [
      { path: 'x.ts', line: 1, body: 'Fix' },
    ])

    expect(result).not.toContain('for task "')
    expect(result).not.toContain('review feedback for task')
  })

  describe('address mode', () => {
    it('includes inline and PR review comments with fix-oriented instructions', () => {
      const result = compileReviewPrompt(
        'address',
        [{ path: 'src/auth.ts', line: 42, body: 'Missing null check' }],
        [prComment],
      )

      expect(result).toContain('Please address the following review comments:')
      expect(result).toContain('## Code Comments')
      expect(result).toContain('## PR Review Comments')
      expect(result).not.toContain('## General Feedback')
      expect(result).toContain('`src/auth.ts:42`')
      expect(result).toContain('Missing null check')
      expect(result).toContain('[alice] `src/utils.ts:42` — Fix naming')
      expect(result).toContain('Evaluate each comment for validity against the current code before changing anything.')
      expect(result).toContain('Fix the valid ones at the referenced location.')
    })

    it('does not instruct the agent to perform git actions', () => {
      const result = compileReviewPrompt(
        'address',
        [{ path: 'x.ts', line: 1, body: 'Fix this' }],
        [prComment],
      )

      expect(result).not.toMatch(/\bcommit\b|\bpush\b|\bbranch\b/i)
    })
  })

  describe('analyze mode', () => {
    it('uses analysis-oriented instructions without fix wording', () => {
      const result = compileReviewPrompt(
        'analyze',
        [{ path: 'src/auth.ts', line: 42, body: 'Missing null check' }],
      )

      expect(result).toContain('Please analyze the following review comments and give me your analysis of each — do not change any code yet.')
      expect(result).toContain('Do not modify any code — just provide your analysis so I can decide.')
      expect(result).not.toContain('Fix the valid ones at the referenced location.')
    })
  })

  it('keeps inline comments before PR review comments in either mode', () => {
    const inline = [{ path: 'a.ts', line: 1, body: 'Inline comment' }]

    for (const mode of ['address', 'analyze'] as const) {
      const result = compileReviewPrompt(mode, inline, [prComment])
      expect(result.indexOf('## Code Comments')).toBeLessThan(
        result.indexOf('## PR Review Comments'),
      )
    }
  })

  it('omits sections that have no comments', () => {
    const inlineOnly = compileReviewPrompt('address', [
      { path: 'src/foo.ts', line: 5, body: 'Fix this' },
    ])
    expect(inlineOnly).toContain('## Code Comments')
    expect(inlineOnly).not.toContain('## PR Review Comments')

    const prOnly = compileReviewPrompt('address', [], [prComment])
    expect(prOnly).not.toContain('## Code Comments')
    expect(prOnly).toContain('## PR Review Comments')
  })

  it('numbers inline comments starting from one', () => {
    const result = compileReviewPrompt('address', [
      { path: 'a.ts', line: 1, body: 'First' },
      { path: 'b.ts', line: 2, body: 'Second' },
      { path: 'c.ts', line: 3, body: 'Third' },
    ])

    expect(result).toContain('1. `a.ts:1`')
    expect(result).toContain('2. `b.ts:2`')
    expect(result).toContain('3. `c.ts:3`')
  })

  it('formats PR review comments with author and location', () => {
    const result = compileReviewPrompt('address', [], [
      prComment,
      { body: 'Add docs', author: 'bob', file_path: 'src/api.ts', line_number: null },
      { body: 'Overall looks good', author: 'reviewer', file_path: null, line_number: null },
    ])

    expect(result).toContain('1. [alice] `src/utils.ts:42` — Fix naming')
    expect(result).toContain('2. [bob] `src/api.ts` — Add docs')
    expect(result).toContain('3. [reviewer] (general) — Overall looks good')
  })

  it('preserves special characters in comment bodies', () => {
    const result = compileReviewPrompt(
      'address',
      [{ path: 'src/util.ts', line: 1, body: 'Use `Array.from()` instead of `[...set]`' }],
      [{ ...prComment, body: 'The "error" message says: it\'s broken\nPlease fix it' }],
    )

    expect(result).toContain('Use `Array.from()` instead of `[...set]`')
    expect(result).toContain('The "error" message says: it\'s broken\nPlease fix it')
  })
})
