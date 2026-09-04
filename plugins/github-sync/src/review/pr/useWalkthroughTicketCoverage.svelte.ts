import type { PrFileDiff, PrWalkthrough, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import type { CoverageFinding, TicketSnapshot } from '../../lib/ticketCoverage'
import { parseAndValidateTicketCoverage } from '../../lib/ticketCoverageParse'
import { toggleCoverageFinding } from '../../lib/walkthroughViewState'
import type { GithubSyncPrReviewClient } from './githubSyncClient'

interface WalkthroughTicketCoverageDependencies {
  getGithubSync: () => GithubSyncPrReviewClient
  getPullRequest: () => ReviewPullRequest
  getWalkthrough: () => PrWalkthrough | null
  getFiles: () => PrFileDiff[]
}

export interface WalkthroughTicketCoverage {
  readonly snapshot: TicketSnapshot | null
  readonly jiraConfigured: boolean
  readonly coverage: ReturnType<typeof parseAndValidateTicketCoverage>
  readonly includedFindings: CoverageFinding[]
  readonly includedFindingIds: Set<string>
  load: () => Promise<void>
  setIssueKey: (issueKey: string) => Promise<boolean>
  toggleFinding: (finding: CoverageFinding) => void
  removeIncludedFinding: (id: string) => void
  clearIncludedFindings: () => void
}

export function useWalkthroughTicketCoverage(
  dependencies: WalkthroughTicketCoverageDependencies,
): WalkthroughTicketCoverage {
  let snapshot = $state<TicketSnapshot | null>(null)
  let jiraConfigured = $state(false)
  let includedFindings = $state<CoverageFinding[]>([])
  let includedFindingIds = $derived(new Set(includedFindings.map(finding => finding.id)))
  let coverage = $derived(
    dependencies.getWalkthrough()?.status === 'ready'
      ? parseAndValidateTicketCoverage(
          dependencies.getWalkthrough()?.steps_json ?? null,
          dependencies.getFiles(),
        )
      : null,
  )

  async function load(): Promise<void> {
    const pr = dependencies.getPullRequest()
    try {
      const result = await dependencies.getGithubSync().getPrTicket({
        reviewPrId: pr.id,
        headSha: pr.head_sha,
      })
      snapshot = result?.snapshot ?? null
      jiraConfigured = result?.jiraConfigured ?? false
    } catch (error) {
      console.error('[WalkthroughTab] Failed to load the Jira ticket:', error)
      snapshot = null
      jiraConfigured = false
    }
  }

  async function setIssueKey(issueKey: string): Promise<boolean> {
    try {
      await dependencies.getGithubSync().setPrJiraKey({
        reviewPrId: dependencies.getPullRequest().id,
        issueKey,
      })
      return true
    } catch (error) {
      console.error('[WalkthroughTab] Failed to set the Jira ticket key:', error)
      return false
    }
  }

  function toggleFinding(finding: CoverageFinding): void {
    includedFindings = toggleCoverageFinding(includedFindings, finding)
  }

  function removeIncludedFinding(id: string): void {
    includedFindings = includedFindings.filter(finding => finding.id !== id)
  }

  function clearIncludedFindings(): void {
    includedFindings = []
  }

  return {
    get snapshot() {
      return snapshot
    },
    get jiraConfigured() {
      return jiraConfigured
    },
    get coverage() {
      return coverage
    },
    get includedFindings() {
      return includedFindings
    },
    get includedFindingIds() {
      return includedFindingIds
    },
    load,
    setIssueKey,
    toggleFinding,
    removeIncludedFinding,
    clearIncludedFindings,
  }
}
