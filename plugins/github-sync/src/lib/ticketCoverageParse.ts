import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import {
  CRITERION_STATUSES,
  TICKET_COVERAGE_VERDICTS,
  type CoverageCriterion,
  type CoverageEvidence,
  type CriterionStatus,
  type OutOfScopeChange,
  type TicketCoverage,
  type TicketCoverageVerdict,
} from './ticketCoverage'

/**
 * Parse the agent's `ticket_coverage` block out of its stored JSON and validate
 * it against the live PR diff.
 *
 * Follows the same drop-don't-reject discipline as `walkthroughParse`: bad parts
 * are discarded so one hallucinated filename never costs the reviewer the whole
 * analysis. Returns null only when nothing usable survives.
 */
export function parseAndValidateTicketCoverage(
  raw: string | null | undefined,
  files: PrFileDiff[],
): TicketCoverage | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const block = asRecord(parsed)?.ticket_coverage
  const coverage = asRecord(block)
  if (!coverage) return null

  const knownFilenames = new Set(files.map(file => file.filename))
  const summary = asString(coverage.summary)?.trim() ?? ''
  const criteria = validateCriteria(coverage.criteria, knownFilenames)

  // Nothing to render, and no prose explaining why. Treat as absent so the UI
  // offers a regenerate rather than an empty panel.
  if (criteria.length === 0 && summary.length === 0) return null

  return {
    verdict: validateVerdict(coverage.verdict),
    summary,
    criteria,
    out_of_scope: validateOutOfScope(coverage.out_of_scope, knownFilenames),
  }
}

/** An unrecognised verdict still leaves usable criteria, so downgrade rather than discard. */
function validateVerdict(value: unknown): TicketCoverageVerdict {
  const verdict = asString(value)
  return TICKET_COVERAGE_VERDICTS.includes(verdict as TicketCoverageVerdict)
    ? (verdict as TicketCoverageVerdict)
    : 'unassessable'
}

function validateCriteria(value: unknown, knownFilenames: Set<string>): CoverageCriterion[] {
  if (!Array.isArray(value)) return []

  const criteria: CoverageCriterion[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    if (!record) continue

    const id = asString(record.id)
    const text = asString(record.text)?.trim()
    const status = asString(record.status)
    // Without an id, text, and a status we cannot render a row the reviewer can act on.
    if (!id || !text) continue
    if (!CRITERION_STATUSES.includes(status as CriterionStatus)) continue

    criteria.push({
      id,
      text,
      status: status as CriterionStatus,
      evidence: validateEvidence(record.evidence, knownFilenames),
      notes: asString(record.notes)?.trim() || null,
    })
  }
  return criteria
}

function validateEvidence(value: unknown, knownFilenames: Set<string>): CoverageEvidence[] {
  if (!Array.isArray(value)) return []

  const evidence: CoverageEvidence[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    const filename = record && asString(record.filename)
    if (!filename || !knownFilenames.has(filename)) continue
    evidence.push({ filename, note: asString(record.note)?.trim() || null })
  }
  return evidence
}

function validateOutOfScope(value: unknown, knownFilenames: Set<string>): OutOfScopeChange[] {
  if (!Array.isArray(value)) return []

  const changes: OutOfScopeChange[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    const description = record && asString(record.description)?.trim()
    if (!description) continue

    const files = Array.isArray(record.files)
      ? record.files.filter(
          (filename): filename is string =>
            typeof filename === 'string' && knownFilenames.has(filename),
        )
      : []
    changes.push({ description, files })
  }
  return changes
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
