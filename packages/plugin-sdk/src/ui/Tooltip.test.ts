import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import TooltipTestWrapper from './TooltipTestWrapper.svelte'

describe('plugin-sdk Tooltip', () => {
  it('exposes a named trigger and controlled open state without synthetic callbacks', async () => {
    const onOpenChange = vi.fn()
    render(TooltipTestWrapper, { props: { onOpenChange } })
    await tick()

    const trigger = screen.getByRole('button', { name: 'Review status help' })
    expect(trigger.textContent).toContain('Help')
    await fireEvent.click(screen.getByRole('button', { name: 'Show help externally' }))

    expect(screen.getByRole('tooltip').textContent).toBe('Shows whether review is required')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('portals and positions the accessible description', async () => {
    const view = render(TooltipTestWrapper)
    await tick()
    await fireEvent.click(screen.getByRole('button', { name: 'Show help externally' }))
    await tick()

    const trigger = screen.getByRole('button', { name: 'Review status help' })
    const tooltip = screen.getByRole('tooltip')
    expect(view.container.contains(tooltip)).toBe(false)
    expect(tooltip.closest('[data-side]')).not.toBeNull()
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id)
  })

  it('opens from keyboard focus and dismisses on Escape without moving focus', async () => {
    const onOpenChange = vi.fn()
    render(TooltipTestWrapper, { props: { onOpenChange } })
    await tick()
    const trigger = screen.getByRole('button', { name: 'Review status help' })

    trigger.focus()
    await tick()
    expect(screen.queryByRole('tooltip')).not.toBeNull()

    await fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('does not open or report changes when disabled', async () => {
    const onOpenChange = vi.fn()
    render(TooltipTestWrapper, { props: { disabled: true, onOpenChange } })
    await tick()
    const trigger = screen.getByRole('button', { name: 'Review status help' })

    expect(trigger.hasAttribute('disabled')).toBe(true)
    trigger.focus()
    await fireEvent.pointerEnter(trigger)
    await tick()

    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
