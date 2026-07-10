import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SourceTicketLink from './SourceTicketLink.svelte'
import { openUrl } from '../../lib/ipc'

vi.mock('../../lib/ipc', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

describe('SourceTicketLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when there is no source ticket', () => {
    const { container } = render(SourceTicketLink, { props: { url: null } })
    expect(container.textContent?.trim()).toBe('')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing when the source ticket is only whitespace', () => {
    const { container } = render(SourceTicketLink, { props: { url: '   ' } })
    expect(container.textContent?.trim()).toBe('')
  })

  it('renders a clickable control for a GitHub issue URL and opens it via openUrl', async () => {
    render(SourceTicketLink, { props: { url: 'https://github.com/koenvg/openforge/issues/1294' } })

    const button = screen.getByRole('button', { name: /koenvg\/openforge#1294/ })
    expect(button).toBeTruthy()

    await fireEvent.click(button)

    await waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith('https://github.com/koenvg/openforge/issues/1294')
    })
  })

  it('renders the Jira issue key label for an Atlassian browse URL', () => {
    render(SourceTicketLink, { props: { url: 'https://acme.atlassian.net/browse/ABC-123' } })
    expect(screen.getByRole('button', { name: /ABC-123/ })).toBeTruthy()
  })

  it('renders non-URL text as plain, non-clickable content', () => {
    render(SourceTicketLink, { props: { url: 'ABC-123' } })

    expect(screen.getByText('ABC-123')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('never opens a non-http(s) scheme', () => {
    render(SourceTicketLink, { props: { url: 'javascript:alert(1)' } })
    expect(screen.queryByRole('button')).toBeNull()
    expect(openUrl).not.toHaveBeenCalled()
  })
})
