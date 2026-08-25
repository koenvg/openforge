import { describe, expect, it } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { parseAndValidateTicketCoverage } from './ticketCoverageParse'

function file(filename: string): PrFileDiff {
  return {
    sha: 'sha',
    filename,
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: '@@ -1,1 +1,2 @@\n context\n+added',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: 2,
  }
}

const FILES = [file('src/login.ts'), file('src/session.ts')]

function wrap(coverage: unknown): string {
  return JSON.stringify({ steps: [], review_comments: [], ticket_coverage: coverage })
}

const WELL_FORMED = {
  verdict: 'partial',
  summary: 'Login lands, session expiry does not.',
  criteria: [
    {
      id: 'ac-1',
      text: 'The user can log in with email and password.',
      status: 'covered',
      evidence: [{ filename: 'src/login.ts', note: 'Adds the login handler.' }],
      notes: null,
    },
    {
      id: 'ac-2',
      text: 'Sessions expire after 30 minutes.',
      status: 'missing',
      evidence: [],
      notes: 'No expiry logic anywhere in the diff.',
    },
  ],
  out_of_scope: [{ description: 'Adds a password strength meter.', files: ['src/login.ts'] }],
}

describe('parseAndValidateTicketCoverage', () => {
  it('parses a well-formed coverage block', () => {
    const coverage = parseAndValidateTicketCoverage(wrap(WELL_FORMED), FILES)

    expect(coverage).not.toBeNull()
    expect(coverage?.verdict).toBe('partial')
    expect(coverage?.summary).toBe('Login lands, session expiry does not.')
    expect(coverage?.criteria).toHaveLength(2)
    expect(coverage?.criteria[0].evidence).toEqual([
      { filename: 'src/login.ts', note: 'Adds the login handler.' },
    ])
    expect(coverage?.criteria[1].status).toBe('missing')
    expect(coverage?.out_of_scope).toEqual([
      { description: 'Adds a password strength meter.', files: ['src/login.ts'] },
    ])
  })

  it('returns null for missing, empty, or unparseable input', () => {
    expect(parseAndValidateTicketCoverage(null, FILES)).toBeNull()
    expect(parseAndValidateTicketCoverage('', FILES)).toBeNull()
    expect(parseAndValidateTicketCoverage('not json', FILES)).toBeNull()
  })

  it('returns null when the agent produced no ticket_coverage block', () => {
    const raw = JSON.stringify({ steps: [], review_comments: [] })
    expect(parseAndValidateTicketCoverage(raw, FILES)).toBeNull()
  })

  it('drops evidence naming a file that is not in the diff', () => {
    const raw = wrap({
      ...WELL_FORMED,
      criteria: [{
        ...WELL_FORMED.criteria[0],
        evidence: [
          { filename: 'src/login.ts', note: 'real' },
          { filename: 'src/imagined.ts', note: 'hallucinated' },
        ],
      }],
    })

    const coverage = parseAndValidateTicketCoverage(raw, FILES)

    expect(coverage?.criteria[0].evidence.map(e => e.filename)).toEqual(['src/login.ts'])
  })

  it('keeps a criterion whose evidence all drops, since the verdict still matters', () => {
    const raw = wrap({
      ...WELL_FORMED,
      criteria: [{
        ...WELL_FORMED.criteria[0],
        evidence: [{ filename: 'src/imagined.ts', note: 'hallucinated' }],
      }],
    })

    const coverage = parseAndValidateTicketCoverage(raw, FILES)

    expect(coverage?.criteria).toHaveLength(1)
    expect(coverage?.criteria[0].evidence).toEqual([])
  })

  it('drops a criterion with an unrecognised status', () => {
    const raw = wrap({
      ...WELL_FORMED,
      criteria: [
        { ...WELL_FORMED.criteria[0], status: 'probably-fine' },
        WELL_FORMED.criteria[1],
      ],
    })

    const coverage = parseAndValidateTicketCoverage(raw, FILES)

    expect(coverage?.criteria.map(c => c.id)).toEqual(['ac-2'])
  })

  it('drops a criterion with no text, since there is nothing to show the reviewer', () => {
    const raw = wrap({
      ...WELL_FORMED,
      criteria: [{ id: 'ac-1', status: 'covered' }, WELL_FORMED.criteria[1]],
    })

    expect(parseAndValidateTicketCoverage(raw, FILES)?.criteria.map(c => c.id)).toEqual(['ac-2'])
  })

  it('falls back to unassessable when the verdict is unrecognised', () => {
    const raw = wrap({ ...WELL_FORMED, verdict: 'mostly there' })
    expect(parseAndValidateTicketCoverage(raw, FILES)?.verdict).toBe('unassessable')
  })

  it('filters out_of_scope files to the diff but keeps the entry', () => {
    const raw = wrap({
      ...WELL_FORMED,
      out_of_scope: [{ description: 'Extra behaviour.', files: ['src/session.ts', 'nope.ts'] }],
    })

    expect(parseAndValidateTicketCoverage(raw, FILES)?.out_of_scope).toEqual([
      { description: 'Extra behaviour.', files: ['src/session.ts'] },
    ])
  })

  it('drops an out_of_scope entry with no description', () => {
    const raw = wrap({ ...WELL_FORMED, out_of_scope: [{ files: ['src/login.ts'] }] })
    expect(parseAndValidateTicketCoverage(raw, FILES)?.out_of_scope).toEqual([])
  })

  it('defaults absent evidence and out_of_scope arrays to empty', () => {
    const raw = wrap({
      verdict: 'complete',
      summary: 'All good.',
      criteria: [{ id: 'ac-1', text: 'Works.', status: 'covered' }],
    })

    const coverage = parseAndValidateTicketCoverage(raw, FILES)

    expect(coverage?.criteria[0].evidence).toEqual([])
    expect(coverage?.criteria[0].notes).toBeNull()
    expect(coverage?.out_of_scope).toEqual([])
  })

  it('returns null when no criterion survives and there is no summary', () => {
    const raw = wrap({ verdict: 'partial', summary: '   ', criteria: [{ id: 'x' }] })
    expect(parseAndValidateTicketCoverage(raw, FILES)).toBeNull()
  })

  it('keeps a summary-only assessment when every criterion was malformed', () => {
    // The prose is still worth showing; losing it would hide that the agent
    // looked at the ticket at all.
    const raw = wrap({ verdict: 'unassessable', summary: 'The ticket has no criteria.', criteria: [] })

    const coverage = parseAndValidateTicketCoverage(raw, FILES)

    expect(coverage?.summary).toBe('The ticket has no criteria.')
    expect(coverage?.criteria).toEqual([])
  })
})
