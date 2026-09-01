/**
 * The agent's assessment of whether a PR implements its Jira ticket.
 *
 * These types are local to the plugin on purpose: nothing outside github-sync
 * consumes them, so they stay out of the shared SDK domain.
 */

export type TicketCoverageVerdict = 'complete' | 'partial' | 'missing' | 'unassessable'

export type CriterionStatus = 'covered' | 'partial' | 'missing' | 'unclear'

export const TICKET_COVERAGE_VERDICTS: readonly TicketCoverageVerdict[] = [
  'complete', 'partial', 'missing', 'unassessable',
]

export const CRITERION_STATUSES: readonly CriterionStatus[] = [
  'covered', 'partial', 'missing', 'unclear',
]

/** A changed file the agent cites as satisfying (or failing) a criterion. */
export interface CoverageEvidence {
  filename: string
  note: string | null
}

export interface CoverageCriterion {
  id: string
  /** The criterion as stated in the ticket, quoted back verbatim. */
  text: string
  status: CriterionStatus
  evidence: CoverageEvidence[]
  notes: string | null
}

/**
 * A functional change the PR makes that the ticket never asked for. Scoped to
 * user-observable behaviour — refactors and test changes are explicitly not
 * reported here (see the prompt rules).
 */
export interface OutOfScopeChange {
  description: string
  files: string[]
}

export interface TicketCoverage {
  verdict: TicketCoverageVerdict
  summary: string
  criteria: CoverageCriterion[]
  out_of_scope: OutOfScopeChange[]
}

/**
 * A coverage criterion or out-of-scope item the reviewer chose to fold into
 * the PR review. Structurally matches `IncludedFinding` in
 * `@openforge-app/pr-review-ui/reviewBody`, kept as a separate local type so
 * this plugin doesn't need to import across that package boundary.
 */
export interface CoverageFinding {
  id: string
  label: string
  text: string
}

/** A Jira work item as returned by the core `fetchJiraWorkItem` host command. */
export interface JiraWorkItem {
  issue_key: string
  url: string
  summary: string
  description: string
  /**
   * The acceptance-criteria custom field, flattened to text. Empty when no field
   * is configured or the ticket leaves it blank. When present this is the
   * authoritative list the diff is judged against.
   */
  acceptance_criteria: string
  status: string | null
  issue_type: string | null
}

/**
 * What the plugin caches per (PR, head SHA). `error` is set when the fetch
 * failed; `item` is null in that case. Both null means no key was resolved.
 */
export interface TicketSnapshot {
  issue_key: string | null
  item: JiraWorkItem | null
  error: string | null
  fetched_at: number
}
