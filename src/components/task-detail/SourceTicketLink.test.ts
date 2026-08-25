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

  // The task inspector keys its row padding off this attribute so the ticket row and the
  // empty pull request row line up. Plugin sections opt in with the same value.
  it('marks the card as a row for the task inspector', () => {
    const { container } = render(SourceTicketLink, { props: { url: null, onSave: vi.fn() } })
    const section = container.querySelector('[data-task-info-card="source-ticket"]')
    expect(section?.getAttribute('data-card-layout')).toBe('row')
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

  describe('editable mode (onSave provided)', () => {
    it('shows an add affordance when there is no ticket', () => {
      render(SourceTicketLink, { props: { url: null, onSave: vi.fn() } })
      expect(screen.getByRole('button', { name: 'Add source ticket link' })).toBeTruthy()
    })

    it('adds a link: entering a value and saving calls onSave with the normalized URL', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(SourceTicketLink, { props: { url: null, onSave } })

      await fireEvent.click(screen.getByRole('button', { name: 'Add source ticket link' }))
      await fireEvent.input(screen.getByLabelText('Source ticket link'), {
        target: { value: '  https://github.com/koenvg/openforge/issues/1294  ' },
      })
      await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('https://github.com/koenvg/openforge/issues/1294')
      })
    })

    it('exposes an edit affordance when a ticket already exists', () => {
      render(SourceTicketLink, {
        props: { url: 'https://github.com/koenvg/openforge/issues/1294', onSave: vi.fn() },
      })
      expect(screen.getByRole('button', { name: 'Edit source ticket link' })).toBeTruthy()
    })

    it('clears the link when saving a blank value', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined)
      render(SourceTicketLink, {
        props: { url: 'https://github.com/koenvg/openforge/issues/1294', onSave },
      })

      await fireEvent.click(screen.getByRole('button', { name: 'Edit source ticket link' }))
      await fireEvent.input(screen.getByLabelText('Source ticket link'), { target: { value: '   ' } })
      await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(null)
      })
    })

    it('cancelling does not call onSave and keeps the original link visible', async () => {
      const onSave = vi.fn()
      render(SourceTicketLink, {
        props: { url: 'https://github.com/koenvg/openforge/issues/1294', onSave },
      })

      await fireEvent.click(screen.getByRole('button', { name: 'Edit source ticket link' }))
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onSave).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /koenvg\/openforge#1294/ })).toBeTruthy()
    })

    it('surfaces an error and stays in edit mode when onSave rejects', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Backend unavailable'))
      render(SourceTicketLink, { props: { url: null, onSave } })

      await fireEvent.click(screen.getByRole('button', { name: 'Add source ticket link' }))
      await fireEvent.input(screen.getByLabelText('Source ticket link'), {
        target: { value: 'PROJ-1' },
      })
      await fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('Backend unavailable')
      expect(screen.getByLabelText('Source ticket link')).toBeTruthy()
    })
  })
})
