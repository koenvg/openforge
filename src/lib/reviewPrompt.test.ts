import { describe, it, expect } from 'vitest'
import { compileReviewPrompt } from './reviewPrompt'

describe('compileReviewPrompt', () => {
  it('returns empty string for no comments', () => {
    expect(compileReviewPrompt('address', [], [])).toBe('')
    expect(compileReviewPrompt('analyze', [], [])).toBe('')
  })

  it('returns empty string when only empty arrays provided (including prReviewComments)', () => {
    expect(compileReviewPrompt('address', [], [], [])).toBe('')
  })

  it('does not include the task initial prompt', () => {
    const result = compileReviewPrompt('address', [{ path: 'x.ts', line: 1, body: 'Fix' }], [])
    // The old template embedded the task title/initial prompt — it must be gone.
    expect(result).not.toContain('for task "')
    expect(result).not.toContain('review feedback for task')
  })

  describe('address mode', () => {
    it('opens with an address instruction and fix-oriented closing', () => {
      const result = compileReviewPrompt(
        'address',
        [{ path: 'src/auth.ts', line: 42, body: 'Missing null check' }],
        [{ body: 'Add error handling throughout' }]
      )
      expect(result).toContain('Please address the following review comments:')
      expect(result).toContain('## Code Comments')
      expect(result).toContain('## General Feedback')
      expect(result).toContain('`src/auth.ts:42`')
      expect(result).toContain('Missing null check')
      expect(result).toContain('Add error handling throughout')
      expect(result).toContain('Evaluate each comment for validity against the current code before changing anything.')
      expect(result).toContain('Fix the valid ones at the referenced location.')
      expect(result).toContain("If a comment is invalid, stale, or already addressed, don't change code for it — explain why.")
    })

    it('does not instruct the agent to perform git actions', () => {
      const result = compileReviewPrompt(
        'address',
        [{ path: 'x.ts', line: 1, body: 'Fix this' }],
        [{ body: 'General note' }],
        [{ body: 'PR note', author: 'reviewer', file_path: 'y.ts', line_number: 2 }]
      )
      expect(result).not.toMatch(/\bcommit\b|\bpush\b|\bbranch\b/i)
    })
  })

  describe('analyze mode', () => {
    it('opens with an analyze instruction and analysis-oriented closing, without fix wording', () => {
      const result = compileReviewPrompt(
        'analyze',
        [{ path: 'src/auth.ts', line: 42, body: 'Missing null check' }],
        []
      )
      expect(result).toContain('Please analyze the following review comments and give me your analysis of each — do not change any code yet.')
      expect(result).toContain('## Code Comments')
      expect(result).toContain('`src/auth.ts:42`')
      expect(result).toContain('Do not modify any code — just provide your analysis so I can decide.')
      // Must not carry the address-mode "Fix the valid ones" instruction.
      expect(result).not.toContain('Fix the valid ones at the referenced location.')
    })

    it('does not instruct the agent to perform git actions', () => {
      const result = compileReviewPrompt(
        'analyze',
        [],
        [],
        [{ body: 'PR note', author: 'reviewer', file_path: 'y.ts', line_number: 2 }]
      )
      expect(result).not.toMatch(/\bcommit\b|\bpush\b|\bbranch\b/i)
    })
  })

  it('shares the same comment sections regardless of mode', () => {
    const inline = [{ path: 'a.ts', line: 1, body: 'Inline comment' }]
    const general = [{ body: 'General comment' }]
    const pr = [{ body: 'PR comment', author: 'dev', file_path: 'b.ts', line_number: 5 }]
    for (const mode of ['address', 'analyze'] as const) {
      const result = compileReviewPrompt(mode, inline, general, pr)
      expect(result).toContain('## Code Comments')
      expect(result).toContain('## PR Review Comments')
      expect(result).toContain('## General Feedback')
      const codeIdx = result.indexOf('## Code Comments')
      const prIdx = result.indexOf('## PR Review Comments')
      const generalIdx = result.indexOf('## General Feedback')
      expect(codeIdx).toBeLessThan(prIdx)
      expect(prIdx).toBeLessThan(generalIdx)
    }
  })

  it('omits sections that have no comments', () => {
    const inlineOnly = compileReviewPrompt('address', [{ path: 'src/foo.ts', line: 5, body: 'Fix this' }], [])
    expect(inlineOnly).toContain('## Code Comments')
    expect(inlineOnly).not.toContain('## General Feedback')
    expect(inlineOnly).not.toContain('## PR Review Comments')

    const generalOnly = compileReviewPrompt('address', [], [{ body: 'Improve test coverage' }])
    expect(generalOnly).not.toContain('## Code Comments')
    expect(generalOnly).toContain('## General Feedback')
  })

  it('numbers list items starting from 1', () => {
    const inline = [
      { path: 'a.ts', line: 1, body: 'First' },
      { path: 'b.ts', line: 2, body: 'Second' },
      { path: 'c.ts', line: 3, body: 'Third' },
    ]
    const result = compileReviewPrompt('address', inline, [])
    expect(result).toContain('1. `a.ts:1`')
    expect(result).toContain('2. `b.ts:2`')
    expect(result).toContain('3. `c.ts:3`')
  })

  it('formats PR review comments with author and location, and (general) when no file path', () => {
    const prComments = [
      { body: 'Fix naming', author: 'alice', file_path: 'src/utils.ts', line_number: 42 },
      { body: 'Add docs', author: 'bob', file_path: 'src/api.ts', line_number: null },
      { body: 'Overall looks good', author: 'reviewer', file_path: null, line_number: null },
    ]
    const result = compileReviewPrompt('address', [], [], prComments)
    expect(result).toContain('1. [alice] `src/utils.ts:42` — Fix naming')
    expect(result).toContain('2. [bob] `src/api.ts` — Add docs')
    expect(result).toContain('3. [reviewer] (general) — Overall looks good')
  })

  it('preserves special characters in comment bodies', () => {
    const inline = [{ path: 'src/util.ts', line: 1, body: 'Use `Array.from()` instead of `[...set]`' }]
    const general = [{ body: 'The "error" message says: it\'s broken\nPlease fix it' }]
    const result = compileReviewPrompt('address', inline, general)
    expect(result).toContain('Use `Array.from()` instead of `[...set]`')
    expect(result).toContain('The "error" message says: it\'s broken\nPlease fix it')
  })
})
