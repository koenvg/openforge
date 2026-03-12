import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import IconRail from './IconRail.svelte'
import type { AppView } from '../lib/types'

describe('IconRail', () => {
  it('renders the logo text ">_"', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), authoredPrCount: 0 } })
    expect(screen.getByText('>_')).toBeTruthy()
  })

  it('renders 5 navigation buttons', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
  })

  it('clicking first button (dashboard) calls onNavigate with "board"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'settings' as AppView, onNavigate, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])
    expect(onNavigate).toHaveBeenCalledWith('board')
  })

  it('clicking second button (pr) calls onNavigate with "pr_review"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[1])
    expect(onNavigate).toHaveBeenCalledWith('pr_review')
  })

  it('clicking third button (skills) calls onNavigate with "skills"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[2])
    expect(onNavigate).toHaveBeenCalledWith('skills')
  })

  it('clicking fourth button calls onNavigate with "workqueue"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[3])
    expect(onNavigate).toHaveBeenCalledWith('workqueue')
  })

  it('clicking fifth button calls onNavigate with "settings"', () => {
    const onNavigate = vi.fn()
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate, authoredPrCount: 0 } })
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[4])
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })

  it('shows review request count badge when reviewRequestCount > 0', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), reviewRequestCount: 3, authoredPrCount: 0 } })
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('does not show badge when reviewRequestCount is 0', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), reviewRequestCount: 0, authoredPrCount: 0 } })
    expect(screen.queryByText('0')).toBeNull()
  })

  it('shows authored PR count badge when authoredPrCount > 0', () => {
    render(IconRail, { props: { currentView: 'board' as AppView, onNavigate: vi.fn(), reviewRequestCount: 0, authoredPrCount: 5 } })
    expect(screen.getByText('5')).toBeTruthy()
  })

})
