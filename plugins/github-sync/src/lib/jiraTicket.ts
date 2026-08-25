import { parseProjectKeys, resolveJiraKey, type JiraKeySource } from './jiraKey'
import type { JiraConfig } from './jiraStore'
import type { JiraWorkItem, TicketSnapshot } from './ticketCoverage'

/**
 * The preliminary step of a PR review: work out which Jira ticket the PR
 * implements and fetch it, so the agent can judge the diff against the thing it
 * was supposed to build.
 *
 * Fetching is injected rather than imported, both to keep this testable and
 * because the real implementation lives in core — the plugin asks for a work
 * item and never sees the API token.
 */
export interface TicketResolutionDeps {
  config: JiraConfig
  tokenConfigured: boolean
  /** Reviewer-supplied key for this PR, if any. */
  override: string | null
  pr: JiraKeySource
  fetchWorkItem: (request: {
    baseUrl: string
    email: string
    issueKey: string
    /** null when no acceptance-criteria custom field is configured. */
    acFieldId: string | null
  }) => Promise<JiraWorkItem>
  now?: () => number
}

/**
 * Returns null when Jira is not configured — the walkthrough then behaves
 * exactly as it did before this feature existed, with no ticket step.
 *
 * Otherwise always returns a snapshot, even when no key was found or the fetch
 * failed: the ticket step is where the reviewer sets a key or retries, so it has
 * to render in those cases too. A failure here never propagates, because the
 * walkthrough and AI review are still worth producing without the ticket.
 */
export async function resolveTicketSnapshot(
  deps: TicketResolutionDeps,
): Promise<TicketSnapshot | null> {
  const { config, tokenConfigured, override, pr, fetchWorkItem } = deps
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))

  const configured =
    tokenConfigured && config.baseUrl.trim().length > 0 && config.email.trim().length > 0
  if (!configured) return null

  const issueKey = resolveJiraKey(pr, parseProjectKeys(config.projectKeys), override)
  if (!issueKey) {
    return { issue_key: null, item: null, error: null, fetched_at: now() }
  }

  try {
    const item = await fetchWorkItem({
      baseUrl: config.baseUrl.trim(),
      email: config.email.trim(),
      issueKey,
      acFieldId: config.acFieldId.trim() || null,
    })
    return { issue_key: issueKey, item, error: null, fetched_at: now() }
  } catch (error) {
    // Swallowed on purpose: the walkthrough and AI review are still worth
    // producing, so a Jira outage degrades this step rather than the review.
    const message = error instanceof Error ? error.message : String(error)
    return { issue_key: issueKey, item: null, error: message, fetched_at: now() }
  }
}
