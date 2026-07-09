import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, beforeEach } from 'vitest'
import CollapsibleInfoSectionTestWrapper from './CollapsibleInfoSectionTestWrapper.svelte'
import { clearInfoPanelSectionCollapse } from '../../../lib/infoPanelSectionState'

describe('CollapsibleInfoSection', () => {
  beforeEach(() => {
    localStorage.clear()
    clearInfoPanelSectionCollapse()
  })

  it('renders the title and body expanded by default', () => {
    render(CollapsibleInfoSectionTestWrapper, { props: { sectionKey: 'details', title: 'Details' } })

    expect(screen.getByText('Details')).toBeTruthy()
    expect(screen.getByText('Section body content')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses the body on header click and expands again on a second click', async () => {
    render(CollapsibleInfoSectionTestWrapper, { props: { sectionKey: 'details', title: 'Details' } })

    await fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.queryByText('Section body content')).toBeNull()
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('false')

    await fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByText('Section body content')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('renders the actions snippet as a sibling of the header toggle, not nested inside it', () => {
    render(CollapsibleInfoSectionTestWrapper, {
      props: { sectionKey: 'pull-requests', title: 'Pull Requests', withActions: true },
    })

    const action = screen.getByRole('button', { name: 'Section action' })
    const toggle = screen.getByRole('button', { name: 'Pull Requests' })
    expect(action).toBeTruthy()
    expect(toggle.contains(action)).toBe(false)
  })

  it('links the toggle to the body region via aria-controls', () => {
    render(CollapsibleInfoSectionTestWrapper, { props: { sectionKey: 'details', title: 'Details' } })

    const controlsId = screen.getByRole('button', { name: 'Details' }).getAttribute('aria-controls')
    expect(controlsId).toBeTruthy()
    expect(document.getElementById(controlsId as string)?.textContent).toContain('Section body content')
  })

  it('exposes the section aria-label and data-task-info-card', () => {
    render(CollapsibleInfoSectionTestWrapper, {
      props: { sectionKey: 'git-status', title: 'Changes', label: 'Changes', cardId: 'git-status' },
    })

    const section = screen.getByLabelText('Changes')
    expect(section.tagName).toBe('SECTION')
    expect(section.getAttribute('data-task-info-card')).toBe('git-status')
    expect(section.getAttribute('data-card-sizing')).toBe('natural')
  })

  it('persists the collapsed state so a later mount starts collapsed', async () => {
    const first = render(CollapsibleInfoSectionTestWrapper, { props: { sectionKey: 'details', title: 'Details' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.queryByText('Section body content')).toBeNull()
    first.unmount()

    render(CollapsibleInfoSectionTestWrapper, { props: { sectionKey: 'details', title: 'Details' } })
    expect(screen.queryByText('Section body content')).toBeNull()
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('false')
  })
})
