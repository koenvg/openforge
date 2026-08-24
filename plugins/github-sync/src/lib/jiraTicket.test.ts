import { describe, expect, it } from 'vitest'
import { resolveTicketSnapshot, type TicketResolutionDeps } from './jiraTicket'
import type { JiraConfig } from './jiraStore'
import type { JiraWorkItem } from './ticketCoverage'

const CONFIG: JiraConfig = {
  baseUrl: 'https://collibra.atlassian.net',
  email: 'aviv.hadar@collibra.com',
  projectKeys: '',
  acFieldId: 'customfield_12100',
}

function workItem(issueKey: string): JiraWorkItem {
  return {
    issue_key: issueKey,
    url: `https://collibra.atlassian.net/browse/${issueKey}`,
    summary: 'Compare the PR against its ticket',
    description: 'Some description',
    acceptance_criteria: '- The reviewer sees per-criterion coverage.',
    status: 'In Progress',
    issue_type: 'Story',
  }
}

function deps(overrides: Partial<TicketResolutionDeps> = {}): TicketResolutionDeps {
  return {
    config: CONFIG,
    tokenConfigured: true,
    override: null,
    pr: { head_ref: 'openforge/AVIV-304', title: 'Add gap analysis', body: null },
    fetchWorkItem: async ({ issueKey }) => workItem(issueKey),
    now: () => 1_700_000_000,
    ...overrides,
  }
}

describe('resolveTicketSnapshot', () => {
  it('returns null when Jira is not configured, leaving the walkthrough untouched', async () => {
    expect(await resolveTicketSnapshot(deps({ tokenConfigured: false }))).toBeNull()
    expect(await resolveTicketSnapshot(deps({ config: { ...CONFIG, baseUrl: '' } }))).toBeNull()
  })

  it('fetches the ticket detected in the branch name', async () => {
    const snapshot = await resolveTicketSnapshot(deps())

    expect(snapshot?.issue_key).toBe('AVIV-304')
    expect(snapshot?.item?.summary).toBe('Compare the PR against its ticket')
    expect(snapshot?.error).toBeNull()
    expect(snapshot?.fetched_at).toBe(1_700_000_000)
  })

  it('sends the configured site URL and email to the fetcher', async () => {
    const requests: unknown[] = []
    await resolveTicketSnapshot(deps({
      fetchWorkItem: async request => {
        requests.push(request)
        return workItem(request.issueKey)
      },
    }))

    expect(requests).toEqual([{
      baseUrl: 'https://collibra.atlassian.net',
      email: 'aviv.hadar@collibra.com',
      issueKey: 'AVIV-304',
      acFieldId: 'customfield_12100',
    }])
  })

  it('omits the AC field id when none is configured', async () => {
    const requests: { acFieldId?: string | null }[] = []
    await resolveTicketSnapshot(deps({
      config: { ...CONFIG, acFieldId: '  ' },
      fetchWorkItem: async request => {
        requests.push(request)
        return workItem(request.issueKey)
      },
    }))

    expect(requests[0].acFieldId).toBeNull()
  })

  it('prefers the reviewer override over the detected key', async () => {
    const snapshot = await resolveTicketSnapshot(deps({ override: 'KVG-1' }))
    expect(snapshot?.issue_key).toBe('KVG-1')
  })

  it('honours configured project keys when detecting', async () => {
    const snapshot = await resolveTicketSnapshot(deps({
      config: { ...CONFIG, projectKeys: 'KVG' },
      pr: { head_ref: 'openforge/AVIV-304', title: 'Also mentions KVG-77', body: null },
    }))

    expect(snapshot?.issue_key).toBe('KVG-77')
  })

  it('returns an empty snapshot, not null, when no key can be resolved', async () => {
    // Jira is configured, so the ticket step still renders — that is where the
    // reviewer types a key.
    const snapshot = await resolveTicketSnapshot(deps({
      pr: { head_ref: 'chore/bump-deps', title: 'Bump deps', body: null },
    }))

    expect(snapshot).not.toBeNull()
    expect(snapshot?.issue_key).toBeNull()
    expect(snapshot?.item).toBeNull()
    expect(snapshot?.error).toBeNull()
  })

  it('does not call the fetcher when there is no key', async () => {
    let called = false
    await resolveTicketSnapshot(deps({
      pr: { head_ref: 'chore/bump-deps', title: 'Bump deps', body: null },
      fetchWorkItem: async request => {
        called = true
        return workItem(request.issueKey)
      },
    }))

    expect(called).toBe(false)
  })

  it('captures a fetch failure instead of throwing, so the review still runs', async () => {
    const snapshot = await resolveTicketSnapshot(deps({
      fetchWorkItem: async () => {
        throw new Error('Jira ticket AVIV-304 was not found (404).')
      },
    }))

    expect(snapshot?.issue_key).toBe('AVIV-304')
    expect(snapshot?.item).toBeNull()
    expect(snapshot?.error).toContain('404')
  })

  it('records a non-Error rejection as a readable message', async () => {
    const snapshot = await resolveTicketSnapshot(deps({
      fetchWorkItem: async () => {
        throw 'socket hang up'
      },
    }))

    expect(snapshot?.error).toBe('socket hang up')
  })
})
