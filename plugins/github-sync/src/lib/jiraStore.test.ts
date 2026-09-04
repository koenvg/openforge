import { describe, expect, it } from 'vitest'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import {
  EMPTY_JIRA_CONFIG,
  isJiraConfigured,
  jiraKeyOverrideStorageKey,
  readJiraConfig,
  readJiraKeyOverride,
  readTicketSnapshot,
  ticketSnapshotStorageKey,
  writeJiraConfig,
  writeJiraKeyOverride,
  writeTicketSnapshot,
  type JiraConfig,
} from './jiraStore'
import type { TicketSnapshot } from './ticketCoverage'

/** In-memory stand-in for plugin global storage — real behaviour, no mocks. */
function fakeOpenforge(): BackendOpenForgeAPI & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>()
  return {
    entries,
    storage: {
      global: {
        get: async (key: string) => (entries.has(key) ? entries.get(key) : null),
        set: async (key: string, value: unknown) => void entries.set(key, value),
        delete: async (key: string) => void entries.delete(key),
      },
    },
  } as unknown as BackendOpenForgeAPI & { entries: Map<string, unknown> }
}

const CONFIG: JiraConfig = {
  baseUrl: 'https://collibra.atlassian.net',
  email: 'aviv.hadar@collibra.com',
  projectKeys: 'AVIV,KVG',
  acFieldId: 'customfield_12100',
}

describe('storage keys', () => {
  it('keys the ticket override by PR only, since the ticket outlives a commit', () => {
    expect(jiraKeyOverrideStorageKey(42)).toBe('jira:key:42')
  })

  it('keys the ticket snapshot by PR and head sha', () => {
    expect(ticketSnapshotStorageKey(42, 'abc123')).toBe('jira:ticket:42:abc123')
  })
})

describe('isJiraConfigured', () => {
  it('is true only when the URL, the email, and the stored token are all present', () => {
    expect(isJiraConfigured(CONFIG, true)).toBe(true)
  })

  it('is false without a stored token', () => {
    expect(isJiraConfigured(CONFIG, false)).toBe(false)
  })

  it('is false when the site URL or email is blank', () => {
    expect(isJiraConfigured({ ...CONFIG, baseUrl: '   ' }, true)).toBe(false)
    expect(isJiraConfigured({ ...CONFIG, email: '' }, true)).toBe(false)
  })

  it('is false when nothing has been configured at all', () => {
    expect(isJiraConfigured(null, true)).toBe(false)
    expect(isJiraConfigured(EMPTY_JIRA_CONFIG, true)).toBe(false)
  })

  it('does not require project keys or an AC field id, which are optional', () => {
    expect(isJiraConfigured({ ...CONFIG, projectKeys: '' }, true)).toBe(true)
    expect(isJiraConfigured({ ...CONFIG, acFieldId: '' }, true)).toBe(true)
  })
})

describe('config round-trip', () => {
  it('returns the empty config before anything is saved', async () => {
    expect(await readJiraConfig(fakeOpenforge())).toEqual(EMPTY_JIRA_CONFIG)
  })

  it('reads back what was written, including the AC field id', async () => {
    const openforge = fakeOpenforge()
    await writeJiraConfig(openforge, CONFIG)
    expect(await readJiraConfig(openforge)).toEqual(CONFIG)
  })

  it('defaults a config saved before the AC field existed to a blank id', async () => {
    const openforge = fakeOpenforge()
    await openforge.storage.global.set('jira:config', {
      baseUrl: 'https://collibra.atlassian.net',
      email: 'aviv.hadar@collibra.com',
      projectKeys: '',
    })
    expect((await readJiraConfig(openforge)).acFieldId).toBe('')
  })

  it('never stores a token alongside the config', async () => {
    // The token belongs in the keychain. A regression that persisted it here
    // would put a credential in plain SQLite.
    const openforge = fakeOpenforge()
    await writeJiraConfig(openforge, { ...CONFIG, token: 'secret' } as JiraConfig)
    expect(JSON.stringify(await readJiraConfig(openforge))).not.toContain('secret')
  })
})

describe('ticket key override', () => {
  it('is null when the reviewer has not set one', async () => {
    expect(await readJiraKeyOverride(fakeOpenforge(), 42)).toBeNull()
  })

  it('round-trips an override', async () => {
    const openforge = fakeOpenforge()
    await writeJiraKeyOverride(openforge, 42, 'AVIV-304')
    expect(await readJiraKeyOverride(openforge, 42)).toBe('AVIV-304')
  })

  it('clears the override when given null', async () => {
    const openforge = fakeOpenforge()
    await writeJiraKeyOverride(openforge, 42, 'AVIV-304')
    await writeJiraKeyOverride(openforge, 42, null)
    expect(await readJiraKeyOverride(openforge, 42)).toBeNull()
  })

  it('keeps overrides for different PRs apart', async () => {
    const openforge = fakeOpenforge()
    await writeJiraKeyOverride(openforge, 42, 'AVIV-304')
    await writeJiraKeyOverride(openforge, 43, 'KVG-1')
    expect(await readJiraKeyOverride(openforge, 42)).toBe('AVIV-304')
    expect(await readJiraKeyOverride(openforge, 43)).toBe('KVG-1')
  })
})

describe('ticket snapshot', () => {
  const snapshot: TicketSnapshot = {
    issue_key: 'AVIV-304',
    item: {
      issue_key: 'AVIV-304',
      url: 'https://collibra.atlassian.net/browse/AVIV-304',
      summary: 'Compare the PR against its ticket',
      description: 'Some description',
      acceptance_criteria: '',
      status: 'In Progress',
      issue_type: 'Story',
    },
    error: null,
    fetched_at: 1_700_000_000,
  }

  it('is null before generation has run', async () => {
    expect(await readTicketSnapshot(fakeOpenforge(), 42, 'abc')).toBeNull()
  })

  it('round-trips a fetched ticket', async () => {
    const openforge = fakeOpenforge()
    await writeTicketSnapshot(openforge, 42, 'abc', snapshot)
    expect(await readTicketSnapshot(openforge, 42, 'abc')).toEqual(snapshot)
  })

  it('round-trips a failed fetch so the UI can show the error and offer a retry', async () => {
    const openforge = fakeOpenforge()
    const failed: TicketSnapshot = {
      issue_key: 'AVIV-304',
      item: null,
      error: 'Jira ticket AVIV-304 was not found (404).',
      fetched_at: 1_700_000_000,
    }
    await writeTicketSnapshot(openforge, 42, 'abc', failed)
    expect(await readTicketSnapshot(openforge, 42, 'abc')).toEqual(failed)
  })

  it('does not leak a snapshot from a different commit', async () => {
    const openforge = fakeOpenforge()
    await writeTicketSnapshot(openforge, 42, 'abc', snapshot)
    expect(await readTicketSnapshot(openforge, 42, 'def')).toBeNull()
  })
})
