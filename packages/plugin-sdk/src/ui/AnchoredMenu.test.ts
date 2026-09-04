import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import AnchoredMenuTestWrapper from './AnchoredMenuTestWrapper.svelte'

describe('plugin-sdk AnchoredMenu', () => {
  it('exposes a named trigger and controlled open state', async () => {
    const onOpenChange = vi.fn()
    render(AnchoredMenuTestWrapper, { props: { onOpenChange } })
    await tick()

    const trigger = screen.getByRole('button', { name: 'Task actions' })
    expect(trigger.textContent).toContain('Actions')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await fireEvent.click(screen.getByRole('button', { name: 'Open actions externally' }))
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('portals and positions the menu with disabled semantics', async () => {
    const view = render(AnchoredMenuTestWrapper)
    await tick()
    await fireEvent.click(screen.getByRole('button', { name: 'Open actions externally' }))
    await tick()

    const menu = screen.getByRole('menu', { name: 'Task actions' })
    expect(view.container.contains(menu)).toBe(false)
    expect(menu.closest('[data-side]')).not.toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'Archive' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('supports keyboard navigation, skips disabled items, and reports selection', async () => {
    const onSelect = vi.fn()
    render(AnchoredMenuTestWrapper, { props: { onSelect } })
    await tick()
    const trigger = screen.getByRole('button', { name: 'Task actions' })

    trigger.focus()
    await fireEvent.click(screen.getByRole('button', { name: 'Open actions externally' }))
    await tick()
    const rename = screen.getByRole('menuitem', { name: 'Rename' })
    rename.focus()
    expect(document.activeElement).toBe(rename)

    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }))
    await fireEvent.keyDown(document.activeElement!, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('delete')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('dismisses on Escape and reports open changes', async () => {
    const onOpenChange = vi.fn()
    render(AnchoredMenuTestWrapper, { props: { onOpenChange } })
    await tick()
    const trigger = screen.getByRole('button', { name: 'Task actions' })
    await fireEvent.click(screen.getByRole('button', { name: 'Open actions externally' }))

    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('prevents opening when disabled', async () => {
    const onOpenChange = vi.fn()
    render(AnchoredMenuTestWrapper, { props: { disabled: true, onOpenChange } })
    await tick()

    const trigger = screen.getByRole('button', { name: 'Task actions' })
    expect(trigger.hasAttribute('disabled')).toBe(true)
    await fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('supports persistent checkbox items for multi-select menus', async () => {
    const onSelect = vi.fn()
    render(AnchoredMenuTestWrapper, { props: { multiple: true, onSelect } })
    await tick()

    await fireEvent.click(screen.getByRole('button', { name: 'Task actions' }))
    const rename = screen.getByRole('menuitemcheckbox', { name: 'Rename' })
    const remove = screen.getByRole('menuitemcheckbox', { name: 'Delete' })

    expect(within(rename).getByText('3')).toBeTruthy()
    expect(within(remove).getByText('2')).toBeTruthy()
    expect(rename.getAttribute('aria-checked')).toBe('true')
    expect(remove.getAttribute('aria-checked')).toBe('false')

    await fireEvent.click(remove)

    expect(onSelect).toHaveBeenCalledWith('delete')
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Delete' }).getAttribute('aria-checked')).toBe('true')
  })
})
