import { describe, expect, it } from 'vitest'
import sharedDefaultTemplate from '../../shared/defaultHandoffNotesTemplate.md?raw'
import { DEFAULT_HANDOFF_NOTES_TEMPLATE } from './handoffNotes'

describe('handoffNotes', () => {
  it('exports the shared built-in Handoff Notes template resource', () => {
    expect(DEFAULT_HANDOFF_NOTES_TEMPLATE).toBe(sharedDefaultTemplate)
    expect(DEFAULT_HANDOFF_NOTES_TEMPLATE).toContain('## Current summary')
    expect(DEFAULT_HANDOFF_NOTES_TEMPLATE).toContain('## Follow-up tasks')
    expect(DEFAULT_HANDOFF_NOTES_TEMPLATE).not.toContain('## Review focus')
    expect(DEFAULT_HANDOFF_NOTES_TEMPLATE).not.toContain('## Risky files or lines')
    expect(DEFAULT_HANDOFF_NOTES_TEMPLATE).not.toContain('## Tricky API calls or casts')
    expect(DEFAULT_HANDOFF_NOTES_TEMPLATE).not.toContain('## Tests skipped or weak')
  })
})
