import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import SelectTestWrapper from './SelectTestWrapper.svelte'

describe('plugin-sdk Select', () => {
  it('exposes its visible label and helper text as the accessible name and description', async () => {
    render(SelectTestWrapper)
    await tick()

    const trigger = screen.getByRole('button', { name: 'Theme' })
    const describedBy = trigger.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('Choose the application appearance')
    expect(trigger.textContent).toContain('Angular light')
  })

  it('supports controlled value updates and reports selection callbacks', async () => {
    const onValueChange = vi.fn()
    render(SelectTestWrapper, { props: { onValueChange } })
    await tick()

    await fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }))
    const trigger = screen.getByRole('button', { name: 'Theme' })
    expect(trigger.textContent).toContain('Angular dark')
    expect(onValueChange).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: 'Open theme options' }))
    await tick()
    await fireEvent.pointerUp(screen.getByRole('option', { name: 'Angular light' }), { button: 0 })

    expect(onValueChange).toHaveBeenCalledWith('angular-light')
  })

  it('portals its positioned listbox and exposes selected and disabled option states', async () => {
    const view = render(SelectTestWrapper)
    await tick()

    await fireEvent.click(screen.getByRole('button', { name: 'Open theme options' }))
    await tick()
    await tick()

    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    expect(view.container.contains(listbox)).toBe(false)
    expect(listbox.closest('[data-side]')).not.toBeNull()
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    expect(options[2]?.getAttribute('aria-disabled')).toBe('true')
  })

  it('supports keyboard navigation while skipping disabled options', async () => {
    const onValueChange = vi.fn()
    render(SelectTestWrapper, { props: { onValueChange } })
    await tick()
    const trigger = screen.getByRole('button', { name: 'Theme' })

    trigger.focus()
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    await fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(onValueChange).toHaveBeenLastCalledWith('angular-dark')
    expect(trigger.textContent).toContain('Angular dark')
  })

  it('supports controlled open state and reports open changes', async () => {
    const onOpenChange = vi.fn()
    render(SelectTestWrapper, { props: { onOpenChange } })
    await tick()

    await fireEvent.click(screen.getByRole('button', { name: 'Open theme options' }))
    expect(screen.queryByRole('listbox')).not.toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()

    await fireEvent.keyDown(screen.getByRole('button', { name: 'Theme' }), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('prevents interaction and callbacks when disabled', async () => {
    const onValueChange = vi.fn()
    const onOpenChange = vi.fn()
    render(SelectTestWrapper, { props: { disabled: true, onValueChange, onOpenChange } })
    await tick()

    const trigger = screen.getByRole('button', { name: 'Theme' })
    expect(trigger.hasAttribute('disabled')).toBe(true)
    await fireEvent.click(trigger)

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onValueChange).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
