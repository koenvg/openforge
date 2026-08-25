import { render, screen, fireEvent, within } from '@testing-library/svelte'
import { describe, it, expect, beforeEach } from 'vitest'
import CollapsibleSectionTestWrapper from './CollapsibleSectionTestWrapper.svelte'
import { clearCollapsedSections, pluginSectionKey } from '../collapsibleSectionState'

describe('CollapsibleSection', () => {
  beforeEach(() => {
    localStorage.clear()
    clearCollapsedSections()
  })

  it('renders the title and body expanded by default', () => {
    render(CollapsibleSectionTestWrapper, { props: { sectionKey: 'details', title: 'Details' } })

    expect(screen.getByText('Details')).toBeTruthy()
    expect(screen.getByText('Section body content')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses the body on header click and expands again on a second click', async () => {
    render(CollapsibleSectionTestWrapper, { props: { sectionKey: 'details', title: 'Details' } })

    await fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.queryByText('Section body content')).toBeNull()
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('false')

    await fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByText('Section body content')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('renders the actions snippet as a sibling of the header toggle, not nested inside it', () => {
    render(CollapsibleSectionTestWrapper, {
      props: { sectionKey: 'pull-requests', title: 'Pull Requests', withActions: true },
    })

    const action = screen.getByRole('button', { name: 'Section action' })
    const toggle = screen.getByRole('button', { name: 'Pull Requests' })
    expect(action).toBeTruthy()
    expect(toggle.contains(action)).toBe(false)
  })

  it('links the toggle to the body region via aria-controls', () => {
    render(CollapsibleSectionTestWrapper, { props: { sectionKey: 'details', title: 'Details' } })

    const controlsId = screen.getByRole('button', { name: 'Details' }).getAttribute('aria-controls')
    expect(controlsId).toBeTruthy()
    expect(document.getElementById(controlsId as string)?.textContent).toContain('Section body content')
  })

  it('exposes the section aria-label and data-task-info-card', () => {
    render(CollapsibleSectionTestWrapper, {
      props: { sectionKey: 'git-status', title: 'Changes', label: 'Changes', cardId: 'git-status' },
    })

    const section = screen.getByLabelText('Changes')
    expect(section.tagName).toBe('SECTION')
    expect(section.getAttribute('data-task-info-card')).toBe('git-status')
    expect(section.getAttribute('data-card-sizing')).toBe('natural')
  })

  it('persists the collapsed state so a later mount starts collapsed', async () => {
    const first = render(CollapsibleSectionTestWrapper, { props: { sectionKey: 'details', title: 'Details' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.queryByText('Section body content')).toBeNull()
    first.unmount()

    render(CollapsibleSectionTestWrapper, { props: { sectionKey: 'details', title: 'Details' } })
    expect(screen.queryByText('Section body content')).toBeNull()
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('false')
  })

  // The point of the shared store: collapsing on one task collapses it on every task,
  // not just the one you clicked.
  it('shares collapsed state live between two mounts of the same section key', async () => {
    const taskA = render(CollapsibleSectionTestWrapper, {
      props: { sectionKey: 'initial-prompt', title: 'Initial Prompt', body: 'Prompt for task A' },
    })
    const taskB = render(CollapsibleSectionTestWrapper, {
      props: { sectionKey: 'initial-prompt', title: 'Initial Prompt', body: 'Prompt for task B' },
    })

    await fireEvent.click(within(taskA.container).getByRole('button', { name: 'Initial Prompt' }))

    expect(within(taskA.container).queryByText('Prompt for task A')).toBeNull()
    expect(within(taskB.container).queryByText('Prompt for task B')).toBeNull()
  })

  it('keeps sections with different keys independent', async () => {
    const details = render(CollapsibleSectionTestWrapper, {
      props: { sectionKey: 'details', title: 'Details', body: 'Details body' },
    })
    const changes = render(CollapsibleSectionTestWrapper, {
      props: { sectionKey: 'git-status', title: 'Changes', body: 'Changes body' },
    })

    await fireEvent.click(within(details.container).getByRole('button', { name: 'Details' }))

    expect(within(details.container).queryByText('Details body')).toBeNull()
    expect(within(changes.container).getByText('Changes body')).toBeTruthy()
  })

  it('keeps a namespaced plugin section apart from a host section with the same local key', async () => {
    const host = render(CollapsibleSectionTestWrapper, {
      props: { sectionKey: 'details', title: 'Details', body: 'Host details' },
    })
    const plugin = render(CollapsibleSectionTestWrapper, {
      props: { sectionKey: pluginSectionKey('jira', 'details'), title: 'Issue Details', body: 'Plugin details' },
    })

    await fireEvent.click(within(host.container).getByRole('button', { name: 'Details' }))

    expect(within(host.container).queryByText('Host details')).toBeNull()
    expect(within(plugin.container).getByText('Plugin details')).toBeTruthy()
  })
})
