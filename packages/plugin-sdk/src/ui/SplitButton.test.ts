import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import SplitButtonTestWrapper from './SplitButtonTestWrapper.svelte'
import { useBitsUiBodyScrollLockTestLifecycle } from '../../test/bitsUiTestLifecycle'

useBitsUiBodyScrollLockTestLifecycle()

describe('SplitButton', () => {
  it('labels the icon-only menu trigger without opening the menu on focus', async () => {
    render(SplitButtonTestWrapper)
    const trigger = screen.getByRole('button', { name: 'More actions' })
    trigger.focus()
    await tick()
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('More actions')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps primary and menu actions independent without changing the primary label', async () => {
    const onClick = vi.fn()
    const onSelect = vi.fn()
    render(SplitButtonTestWrapper, { onClick, onSelect })
    await fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Set aside' }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('aside')
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Complete' })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    { disabled: true, primaryDisabled: false, menuDisabled: false, primary: true, menu: true },
    { disabled: false, primaryDisabled: true, menuDisabled: false, primary: true, menu: false },
    { disabled: false, primaryDisabled: false, menuDisabled: true, primary: false, menu: true },
  ])('honors disabled states: %j', async ({ primary, menu, ...props }) => {
    const onClick = vi.fn()
    render(SplitButtonTestWrapper, { ...props, onClick })
    const primaryButton = screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement
    const menuButton = screen.getByRole('button', { name: 'More actions' }) as HTMLButtonElement
    expect(primaryButton.disabled).toBe(primary)
    expect(menuButton.disabled).toBe(menu)
    await fireEvent.click(primaryButton)
    expect(onClick).toHaveBeenCalledTimes(primary ? 0 : 1)
    await fireEvent.click(menuButton)
    expect(Boolean(screen.queryByRole('menu'))).toBe(!menu)
  })

  it('supports controlled open state and restores focus on Escape', async () => {
    const onOpenChange = vi.fn()
    render(SplitButtonTestWrapper, { onOpenChange })
    const trigger = screen.getByRole('button', { name: 'More actions' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await fireEvent.click(screen.getByRole('button', { name: 'Open externally' }))
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const item = screen.getByRole('menuitem', { name: 'Set aside' })
    item.focus()
    await fireEvent.keyDown(item, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
