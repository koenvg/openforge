import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import TicketCoveragePanel from './TicketCoveragePanel.svelte'
import type { TicketCoverage, TicketSnapshot } from '../../lib/ticketCoverage'

const SNAPSHOT: TicketSnapshot = {
  issue_key: 'AVIV-304',
  item: {
    issue_key: 'AVIV-304',
    url: 'https://collibra.atlassian.net/browse/AVIV-304',
    summary: 'Compare the PR against its Jira ticket',
    description: 'Reviewers need the ticket beside the diff.',
    acceptance_criteria: '- The reviewer sees per-criterion coverage.',
    status: 'In Progress',
    issue_type: 'Story',
  },
  error: null,
  fetched_at: 1_700_000_000,
}

const COVERAGE: TicketCoverage = {
  verdict: 'partial',
  summary: 'Login lands, session expiry does not.',
  criteria: [
    {
      id: 'ac-1',
      text: 'The user can log in with email and password.',
      status: 'covered',
      evidence: [{ filename: 'src/login.ts', note: 'Adds the login handler.' }],
      notes: null,
    },
    {
      id: 'ac-2',
      text: 'Sessions expire after 30 minutes.',
      status: 'missing',
      evidence: [],
      notes: 'No expiry logic anywhere in the diff.',
    },
  ],
  out_of_scope: [],
}

function renderPanel(props: Partial<Record<string, unknown>> = {}) {
  return render(TicketCoveragePanel, {
    props: {
      snapshot: SNAPSHOT,
      coverage: COVERAGE,
      jiraConfigured: true,
      includedFindingIds: new Set<string>(),
      onOpenUrl: vi.fn(),
      onSetIssueKey: vi.fn(),
      onRegenerate: vi.fn(),
      onToggleFinding: vi.fn(),
      ...props,
    },
  })
}

describe('TicketCoveragePanel', () => {
  it('shows the ticket it judged against', () => {
    renderPanel()
    expect(screen.getByText('AVIV-304')).toBeTruthy()
    expect(screen.getByText('Compare the PR against its Jira ticket')).toBeTruthy()
  })

  it('shows the overall verdict and summary', () => {
    renderPanel()
    expect(screen.getByText(/partial/i)).toBeTruthy()
    expect(screen.getByText('Login lands, session expiry does not.')).toBeTruthy()
  })

  it('lists every acceptance criterion with its status', () => {
    renderPanel()
    expect(screen.getByText('The user can log in with email and password.')).toBeTruthy()
    expect(screen.getByText('Sessions expire after 30 minutes.')).toBeTruthy()
    expect(screen.getByText(/covered/i)).toBeTruthy()
    expect(screen.getByText(/missing/i)).toBeTruthy()
  })

  it('explains why an unmet criterion is unmet', () => {
    renderPanel()
    expect(screen.getByText('No expiry logic anywhere in the diff.')).toBeTruthy()
  })

  it('cites the evidence files for a covered criterion', () => {
    renderPanel()
    expect(screen.getByText('src/login.ts')).toBeTruthy()
  })

  it('hides the out-of-scope section when the PR stayed on task', () => {
    renderPanel()
    expect(screen.queryByText(/not in the ticket/i)).toBeNull()
  })

  it('lists out-of-scope functional changes when there are any', () => {
    renderPanel({
      coverage: {
        ...COVERAGE,
        out_of_scope: [{ description: 'Adds a password strength meter.', files: ['src/login.ts'] }],
      },
    })
    expect(screen.getByText(/not in the ticket/i)).toBeTruthy()
    expect(screen.getByText('Adds a password strength meter.')).toBeTruthy()
  })

  it('offers a regenerate when the ticket loaded but coverage did not', () => {
    const onRegenerate = vi.fn()
    renderPanel({ coverage: null, onRegenerate })

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    expect(onRegenerate).toHaveBeenCalled()
  })

  it('shows the fetch error and lets the reviewer try again', () => {
    const onRegenerate = vi.fn()
    renderPanel({
      snapshot: { ...SNAPSHOT, item: null, error: 'Jira ticket AVIV-304 was not found (404).' },
      coverage: null,
      onRegenerate,
    })

    expect(screen.getByText(/was not found \(404\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRegenerate).toHaveBeenCalled()
  })

  it('asks for a ticket key when none could be detected', async () => {
    const onSetIssueKey = vi.fn()
    renderPanel({
      snapshot: { issue_key: null, item: null, error: null, fetched_at: 1 },
      coverage: null,
      onSetIssueKey,
    })

    const input = screen.getByLabelText(/jira ticket key/i)
    await fireEvent.input(input, { target: { value: 'AVIV-304' } })
    await fireEvent.click(screen.getByRole('button', { name: /^set ticket$/i }))

    expect(onSetIssueKey).toHaveBeenCalledWith('AVIV-304')
  })

  it('lets the reviewer correct a wrongly detected ticket', async () => {
    const onSetIssueKey = vi.fn()
    renderPanel({ onSetIssueKey })

    const input = screen.getByLabelText(/jira ticket key/i)
    await fireEvent.input(input, { target: { value: 'KVG-7' } })
    await fireEvent.click(screen.getByRole('button', { name: /^set ticket$/i }))

    expect(onSetIssueKey).toHaveBeenCalledWith('KVG-7')
  })

  it('shows the acceptance criteria the verdicts were judged against', () => {
    renderPanel()
    expect(screen.getByText(/The reviewer sees per-criterion coverage\./)).toBeTruthy()
  })

  it('omits the criteria block when the ticket has no acceptance-criteria field', () => {
    renderPanel({ snapshot: { ...SNAPSHOT, item: { ...SNAPSHOT.item!, acceptance_criteria: '' } } })
    expect(screen.queryByText(/^Acceptance criteria$/i)).toBeNull()
  })

  it('tells the reviewer how to configure Jira when nothing is set up', () => {
    renderPanel({ snapshot: null, coverage: null, jiraConfigured: false })

    expect(screen.getByText(/not connected/i)).toBeTruthy()
    expect(screen.getByText(/settings/i)).toBeTruthy()
  })

  it('does not offer a ticket key input while Jira is unconfigured', () => {
    // Setting a key would do nothing without credentials; fix the cause first.
    renderPanel({ snapshot: null, coverage: null, jiraConfigured: false })
    expect(screen.queryByLabelText(/jira ticket key/i)).toBeNull()
  })

  it('lets the reviewer add a criterion to the review', () => {
    const onToggleFinding = vi.fn()
    renderPanel({ onToggleFinding })

    fireEvent.click(screen.getAllByRole('button', { name: /^add to review$/i })[0])

    expect(onToggleFinding).toHaveBeenCalledWith({
      id: 'ac-1',
      label: 'Covered',
      text: 'Jira ticket mentions "The user can log in with email and password."',
    })
  })

  it('folds a criterion\'s notes into the finding text', () => {
    const onToggleFinding = vi.fn()
    renderPanel({ onToggleFinding })

    const buttons = screen.getAllByRole('button', { name: /^add to review$/i })
    fireEvent.click(buttons[1])

    expect(onToggleFinding).toHaveBeenCalledWith({
      id: 'ac-2',
      label: 'Missing',
      text: 'Jira ticket mentions "Sessions expire after 30 minutes.", but No expiry logic anywhere in the diff.',
    })
  })

  it('shows an already-included criterion as added', () => {
    renderPanel({ includedFindingIds: new Set(['ac-1']) })

    expect(screen.getByRole('button', { name: /^added$/i })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^add to review$/i })).toHaveLength(1)
  })

  it('lets the reviewer add an out-of-scope change to the review', () => {
    const onToggleFinding = vi.fn()
    renderPanel({
      coverage: {
        ...COVERAGE,
        out_of_scope: [{ description: 'Adds a password strength meter.', files: ['src/login.ts'] }],
      },
      onToggleFinding,
    })

    const buttons = screen.getAllByRole('button', { name: /^add to review$/i })
    fireEvent.click(buttons[buttons.length - 1])

    expect(onToggleFinding).toHaveBeenCalledWith({
      id: 'oos-0',
      label: 'Not in the ticket',
      text: 'Not in the Jira ticket, but changed by this PR: Adds a password strength meter.',
    })
  })

  it('says to regenerate when the walkthrough predates the Jira connection', () => {
    // Jira is configured but this walkthrough ran before that, so no ticket was
    // ever fetched. Reporting "no ticket found" here would blame the PR.
    const onRegenerate = vi.fn()
    renderPanel({ snapshot: null, coverage: null, jiraConfigured: true, onRegenerate })

    expect(screen.getByText(/before Jira was connected/i)).toBeTruthy()
    expect(screen.queryByText(/not connected/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    expect(onRegenerate).toHaveBeenCalled()
  })
})
