import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import JiraSettingsSection from './JiraSettingsSection.svelte'

const SAVED = {
  config: {
    baseUrl: 'https://collibra.atlassian.net',
    email: 'aviv@collibra.com',
    projectKeys: 'AVIV',
    acFieldId: 'customfield_12100',
  },
  tokenConfigured: true,
}

function fakeApi(overrides: Record<string, unknown> = {}) {
  const invoke = vi.fn(async (method: string, _payload?: unknown) => {
    if (method === 'getJiraSettings') return SAVED
    if (method === 'saveJiraSettings') return SAVED
    if (method === 'testJiraConnection') return { ok: true, displayName: 'Aviv Hadar' }
    return null
  })
  return {
    invoke,
    api: { backend: { invoke, whenReady: async () => {} }, ...overrides } as unknown as FrontendOpenForgeAPI,
  }
}

describe('JiraSettingsSection', () => {
  it('loads the saved site URL, email, and project keys', async () => {
    const { api } = fakeApi()
    render(JiraSettingsSection, { props: { api } })

    await waitFor(() => {
      expect(screen.getByLabelText(/site url/i)).toHaveProperty(
        'value',
        'https://collibra.atlassian.net',
      )
    })
    expect(screen.getByLabelText(/email/i)).toHaveProperty('value', 'aviv@collibra.com')
    expect(screen.getByLabelText(/project keys/i)).toHaveProperty('value', 'AVIV')
    expect(screen.getByLabelText(/acceptance criteria field/i)).toHaveProperty(
      'value',
      'customfield_12100',
    )
  })

  it('saves an edited acceptance-criteria field id', async () => {
    const { api, invoke } = fakeApi()
    render(JiraSettingsSection, { props: { api } })
    await waitFor(() => expect(screen.getByLabelText(/acceptance criteria field/i)).toBeTruthy())

    await fireEvent.input(screen.getByLabelText(/acceptance criteria field/i), {
      target: { value: 'customfield_999' },
    })
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('saveJiraSettings', expect.objectContaining({
        config: expect.objectContaining({ acFieldId: 'customfield_999' }),
      }))
    })
  })

  it('reports that a token is stored without ever showing it', async () => {
    const { api } = fakeApi()
    const { container } = render(JiraSettingsSection, { props: { api } })

    await waitFor(() => expect(screen.getByText(/token is stored/i)).toBeTruthy())
    const tokenInput = screen.getByLabelText(/api token/i) as HTMLInputElement
    expect(tokenInput.type).toBe('password')
    expect(tokenInput.value).toBe('')
    expect(container.innerHTML).not.toContain('tokenConfigured')
  })

  it('saves the config and a newly entered token together', async () => {
    const { api, invoke } = fakeApi()
    render(JiraSettingsSection, { props: { api } })
    await waitFor(() => expect(screen.getByLabelText(/site url/i)).toBeTruthy())

    await fireEvent.input(screen.getByLabelText(/api token/i), { target: { value: 'new-token' } })
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('saveJiraSettings', expect.objectContaining({
        config: expect.objectContaining({ baseUrl: 'https://collibra.atlassian.net' }),
        token: 'new-token',
      }))
    })
  })

  it('sends a payload that survives structured cloning', async () => {
    // The payload crosses Electron IPC, which structured-clones it. A Svelte
    // `$state` object is a Proxy and fails that with "An object could not be
    // cloned", so the config has to be flattened before it is handed over.
    const { api, invoke } = fakeApi()
    render(JiraSettingsSection, { props: { api } })
    await waitFor(() => expect(screen.getByLabelText(/site url/i)).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      const call = invoke.mock.calls.find(([method]) => method === 'saveJiraSettings')
      expect(() => structuredClone(call?.[1])).not.toThrow()
    })
  })

  it('leaves the stored token alone when the token field is left blank', async () => {
    const { api, invoke } = fakeApi()
    render(JiraSettingsSection, { props: { api } })
    await waitFor(() => expect(screen.getByLabelText(/site url/i)).toBeTruthy())

    await fireEvent.input(screen.getByLabelText(/site url/i), {
      target: { value: 'https://other.atlassian.net' },
    })
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      const call = invoke.mock.calls.find(([method]) => method === 'saveJiraSettings')
      expect((call?.[1] as { token?: string })?.token ?? '').toBe('')
    })
  })

  it('clears the stored token on request', async () => {
    const { api, invoke } = fakeApi()
    render(JiraSettingsSection, { props: { api } })
    await waitFor(() => expect(screen.getByText(/token is stored/i)).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: /clear token/i }))

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('saveJiraSettings', expect.objectContaining({
        clearToken: true,
      }))
    })
  })

  it('reports a successful connection test with the account name', async () => {
    const { api } = fakeApi()
    render(JiraSettingsSection, { props: { api } })
    await waitFor(() => expect(screen.getByLabelText(/site url/i)).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => expect(screen.getByText(/Aviv Hadar/)).toBeTruthy())
  })

  it('surfaces a failed connection test', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'getJiraSettings') return SAVED
      if (method === 'testJiraConnection') return { ok: false, error: 'Jira rejected the credentials (401).' }
      return null
    })
    const api = { backend: { invoke, whenReady: async () => {} } } as unknown as FrontendOpenForgeAPI
    render(JiraSettingsSection, { props: { api } })
    await waitFor(() => expect(screen.getByLabelText(/site url/i)).toBeTruthy())

    await fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => expect(screen.getByText(/401/)).toBeTruthy())
  })
})
