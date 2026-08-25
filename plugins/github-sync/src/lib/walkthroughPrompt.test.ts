import { describe, it, expect } from 'vitest'
import { compileWalkthroughPrompt } from './walkthroughPrompt'
import type { PrFileDiff, ReviewComment } from '@openforge-app/plugin-sdk/domain'

function makeReviewComment(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 1,
    pr_number: 7,
    repo_owner: 'acme',
    repo_name: 'repo',
    path: 'src/a.ts',
    line: 42,
    side: 'RIGHT',
    body: 'This branch is never hit.',
    author: 'alice',
    created_at: '2026-08-01T00:00:00Z',
    in_reply_to_id: null,
    ...over,
  }
}

function makeFile(over: Partial<PrFileDiff>): PrFileDiff {
  return {
    sha: 'sha',
    filename: 'a.ts',
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: null,
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    ...over,
  }
}

describe('compileWalkthroughPrompt', () => {
  it('includes the PR title', () => {
    const out = compileWalkthroughPrompt({
      title: 'Add user_id to sessions',
      body: null,
      files: [],
    })
    expect(out).toContain('Add user_id to sessions')
  })

  it('includes the PR body when present', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: 'This PR introduces a new column to track session ownership.',
      files: [],
    })
    expect(out).toContain('introduces a new column')
  })

  it('omits a body section when body is null', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: null,
      files: [],
    })
    expect(out).not.toContain('Description')
  })

  it('omits a body section when body is empty/whitespace', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: '   \n  ',
      files: [],
    })
    expect(out).not.toContain('Description')
  })

  it('lists each file with status, filename, and per-hunk indexes', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: null,
      files: [
        makeFile({
          filename: 'src/foo.ts',
          status: 'modified',
          additions: 5,
          deletions: 2,
          patch: `@@ -1,1 +1,2 @@
 a
+B
@@ -10,1 +10,1 @@
-c
+C`,
        }),
      ],
    })
    expect(out).toContain('src/foo.ts')
    expect(out).toContain('modified')
    expect(out).toContain('+5/-2')
    expect(out).toContain('hunk_index: 0')
    expect(out).toContain('hunk_index: 1')
  })

  it('marks added/removed/renamed files distinctly', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: null,
      files: [
        makeFile({ filename: 'new.ts', status: 'added', patch: '@@ -0,0 +1,1 @@\n+x' }),
        makeFile({ filename: 'old.ts', status: 'removed', patch: '@@ -1,1 +0,0 @@\n-x' }),
        makeFile({
          filename: 'renamed.ts',
          previous_filename: 'oldname.ts',
          status: 'renamed',
          patch: null,
        }),
      ],
    })
    expect(out).toContain('added')
    expect(out).toContain('removed')
    expect(out).toContain('renamed')
    expect(out).toContain('oldname.ts → renamed.ts')
  })

  it('notes when a file diff was truncated by the backend', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: null,
      files: [
        makeFile({
          filename: 'big.ts',
          status: 'modified',
          patch: '@@ -1,1 +1,1 @@\n-a\n+A',
          is_truncated: true,
          patch_line_count: 4000,
        }),
      ],
    })
    expect(out).toContain('truncated')
  })

  it('asks for a JSON object with steps[] containing id/title/summary/files', () => {
    const out = compileWalkthroughPrompt({ title: 't', body: null, files: [] })
    expect(out).toContain('"steps"')
    expect(out).toContain('"id"')
    expect(out).toContain('"title"')
    expect(out).toContain('"summary"')
    expect(out).toContain('"files"')
    expect(out).toContain('"hunk_indexes"')
  })

  it('instructs the agent to slice changes by concept, not by file', () => {
    const out = compileWalkthroughPrompt({ title: 't', body: null, files: [] })
    expect(out.toLowerCase()).toContain('concept')
  })

  it('instructs that hunk_indexes must be valid 0-based indexes for that file', () => {
    const out = compileWalkthroughPrompt({ title: 't', body: null, files: [] })
    expect(out.toLowerCase()).toContain('0-based')
  })

  it('lists existing review comments so the agent can avoid duplicating them', () => {
    const out = compileWalkthroughPrompt({
      title: 't',
      body: null,
      files: [],
      existingComments: [
        makeReviewComment({ author: 'alice', path: 'src/a.ts', line: 42, body: 'This branch is never hit.' }),
        makeReviewComment({ id: 2, author: 'bob', body: 'Agreed, remove it.', in_reply_to_id: 1 }),
      ],
    })
    expect(out).toContain('alice')
    expect(out).toContain('This branch is never hit.')
    expect(out).toContain('src/a.ts:42')
    expect(out).toContain('bob')
    expect(out).toContain('Agreed, remove it.')
  })

  it('shows a placeholder when there are no existing review comments', () => {
    const out = compileWalkthroughPrompt({ title: 't', body: null, files: [] })
    expect(out.toLowerCase()).toContain('no existing review comments')
  })

  describe('Jira ticket context', () => {
    const ticket = {
      issue_key: 'AVIV-304',
      url: 'https://collibra.atlassian.net/browse/AVIV-304',
      summary: 'Compare the PR against its Jira ticket',
      description: 'Reviewers need the ticket beside the diff.',
      acceptance_criteria: '',
      status: 'In Progress',
      issue_type: 'Story',
    }

    it('injects the ticket so the agent reads it before the diff', () => {
      const out = compileWalkthroughPrompt({ title: 't', body: null, files: [], ticket })

      expect(out).toContain('AVIV-304')
      expect(out).toContain('Compare the PR against its Jira ticket')
      expect(out).toContain('Reviewers need the ticket beside the diff.')
      expect(out).toContain('In Progress')
      expect(out).toContain('Story')
    })

    it('asks for ticket_coverage only when a ticket is present', () => {
      const withTicket = compileWalkthroughPrompt({ title: 't', body: null, files: [], ticket })
      const without = compileWalkthroughPrompt({ title: 't', body: null, files: [] })

      expect(withTicket).toContain('ticket_coverage')
      expect(without).not.toContain('ticket_coverage')
    })

    it('leaves no placeholder or stray heading behind when there is no ticket', () => {
      const out = compileWalkthroughPrompt({ title: 't', body: null, files: [] })

      expect(out).not.toContain('{{JIRA_TICKET}}')
      expect(out).not.toContain('Source Ticket')
    })

    it('tells the agent to exclude refactors from out_of_scope', () => {
      // The narrowing rule is the whole reason out_of_scope is usable; without
      // it the model reports every rename it sees.
      const out = compileWalkthroughPrompt({ title: 't', body: null, files: [], ticket })

      expect(out).toContain('out_of_scope')
      expect(out.toLowerCase()).toContain('refactor')
    })

    it('handles a ticket with no description', () => {
      const out = compileWalkthroughPrompt({
        title: 't',
        body: null,
        files: [],
        ticket: { ...ticket, description: '', acceptance_criteria: '', status: null, issue_type: null },
      })

      expect(out).toContain('AVIV-304')
      expect(out.toLowerCase()).toContain('no description')
    })

    it('presents the acceptance-criteria field as the authoritative list', () => {
      const out = compileWalkthroughPrompt({
        title: 't',
        body: null,
        files: [],
        ticket: {
          ...ticket,
          acceptance_criteria: '- Login works.\n- Sessions expire after 30 minutes.',
        },
      })

      expect(out).toContain('- Sessions expire after 30 minutes.')
      // The field wins over anything the agent might infer from the description.
      expect(out).toMatch(/authoritative/i)
      expect(out).toContain('exactly these')
    })

    it('falls back to a description section when the field is empty', () => {
      const out = compileWalkthroughPrompt({
        title: 't',
        body: null,
        files: [],
        ticket: {
          ...ticket,
          acceptance_criteria: '',
          description: '## Acceptance Criteria\n\n- Login works.',
        },
      })

      expect(out).toContain('"Acceptance Criteria" section')
      expect(out).not.toMatch(/authoritative/i)
    })

    it('orders the criteria ahead of the description so they are read first', () => {
      const out = compileWalkthroughPrompt({
        title: 't',
        body: null,
        files: [],
        ticket: { ...ticket, acceptance_criteria: '- Login works.' },
      })

      const criteriaAt = out.indexOf('### Acceptance Criteria')
      const descriptionAt = out.indexOf('### Ticket Description')
      expect(criteriaAt).toBeGreaterThan(-1)
      expect(descriptionAt).toBeGreaterThan(-1)
      expect(criteriaAt).toBeLessThan(descriptionAt)
    })

    it('is a no-op against a custom template that lacks the placeholder', () => {
      // Users can override `pr_walkthrough_prompt`. An older template must keep
      // working rather than erroring or silently gaining a ticket section.
      const out = compileWalkthroughPrompt(
        { title: 'My PR', body: null, files: [], ticket },
        'Title: {{PR_TITLE}}\nFiles: {{CHANGED_FILES}}\n',
      )

      expect(out).toBe('Title: My PR\nFiles: (no files in this PR)\n')
    })
  })
})
