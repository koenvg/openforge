import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import TabsTestWrapper from './TabsTestWrapper.svelte'

describe('plugin-sdk Tabs', () => {
  it('exposes the tab list name, selected state, disabled state, and associated panel', async () => {
    render(TabsTestWrapper)
    await tick()

    expect(screen.getByRole('tablist', { name: 'Project sections' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Unavailable' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('tabpanel', { name: 'Overview' }).textContent).toContain('Overview panel')
  })

  it('supports controlled value updates without reporting them as user changes', async () => {
    const onValueChange = vi.fn()
    render(TabsTestWrapper, { props: { onValueChange } })
    await tick()

    await fireEvent.click(screen.getByRole('button', { name: 'Show activity' }))

    expect(screen.getByRole('tab', { name: 'Activity' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel', { name: 'Activity' }).textContent).toContain('Activity panel')
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('reports user selection and ignores disabled tabs', async () => {
    const onValueChange = vi.fn()
    render(TabsTestWrapper, { props: { onValueChange } })
    await tick()

    await fireEvent.click(screen.getByRole('tab', { name: 'Unavailable' }))
    expect(onValueChange).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(onValueChange).toHaveBeenCalledWith('activity')
  })

  it('uses arrow-key navigation and skips disabled tabs', async () => {
    const onValueChange = vi.fn()
    render(TabsTestWrapper, { props: { onValueChange } })
    await tick()

    const overview = screen.getByRole('tab', { name: 'Overview' })
    overview.focus()
    await fireEvent.keyDown(overview, { key: 'ArrowRight' })

    const activity = screen.getByRole('tab', { name: 'Activity' })
    expect(document.activeElement).toBe(activity)
    expect(activity.getAttribute('aria-selected')).toBe('true')
    expect(onValueChange).toHaveBeenCalledWith('activity')
  })

  it('disables the complete tab set', async () => {
    const onValueChange = vi.fn()
    render(TabsTestWrapper, { props: { disabled: true, onValueChange } })
    await tick()

    for (const tab of screen.getAllByRole('tab')) expect(tab.hasAttribute('disabled')).toBe(true)
    await fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(onValueChange).not.toHaveBeenCalled()
  })
})
