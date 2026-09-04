import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, it, expect, vi } from 'vitest'
import ContextMenuTest from './ContextMenu.test.svelte'

describe('ContextMenu', () => {
  it('renders children when visible is true', () => {
    render(ContextMenuTest, { props: { visible: true, x: 100, y: 200, onClose: vi.fn() } })
    expect(screen.getByText('Test Item')).toBeTruthy()
  })

  it('does not render when visible is false', () => {
    render(ContextMenuTest, { props: { visible: false, x: 100, y: 200, onClose: vi.fn() } })
    expect(screen.queryByText('Test Item')).toBeNull()
  })

  it('calls onClose when clicking outside', async () => {
    const onClose = vi.fn()
    render(ContextMenuTest, { props: { visible: true, x: 100, y: 200, onClose } })
    await fireEvent.click(window)
    expect(onClose).toHaveBeenCalled()
  })

  it('renders menu item with correct label', () => {
    render(ContextMenuTest, { props: { visible: true, x: 0, y: 0, onClose: vi.fn() } })
    expect(screen.getByText('Test Item')).toBeTruthy()
    expect(screen.getByText('Danger Item')).toBeTruthy()
  })

  it('calls menu item onclick when clicked', async () => {
    const onClose = vi.fn()
    render(ContextMenuTest, { props: { visible: true, x: 0, y: 0, onClose } })
    await fireEvent.click(screen.getByText('Test Item'))
    // The test harness sets a data attribute when clicked
    expect(screen.getByTestId('clicked-item').textContent).toBe('Test Item')
  })

  it('does not submit a surrounding form when a menu action is clicked', async () => {
    render(ContextMenuTest, { props: { visible: true, x: 0, y: 0, onClose: vi.fn() } })

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Test Item' }))

    expect(screen.getByTestId('clicked-item').textContent).toBe('Test Item')
    expect(screen.getByTestId('form-submitted').textContent).toBe('false')
  })

  it('focuses the first enabled item when opened', async () => {
    render(ContextMenuTest, { props: { visible: true, x: 0, y: 0, onClose: vi.fn() } })

    await tick()

    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Test Item' }))
  })

  it('moves focus through enabled items with menu navigation keys', async () => {
    render(ContextMenuTest, { props: { visible: true, x: 0, y: 0, onClose: vi.fn() } })
    const firstItem = screen.getByRole('menuitem', { name: 'Test Item' })
    const lastItem = screen.getByRole('menuitem', { name: 'Danger Item' })
    await tick()

    await fireEvent.keyDown(firstItem, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(lastItem)

    await fireEvent.keyDown(lastItem, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(firstItem)

    await fireEvent.keyDown(firstItem, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(lastItem)

    await fireEvent.keyDown(lastItem, { key: 'Home' })
    expect(document.activeElement).toBe(firstItem)

    await fireEvent.keyDown(firstItem, { key: 'End' })
    expect(document.activeElement).toBe(lastItem)
  })

  it('closes on Escape and restores focus to the invoking control', async () => {
    const onClose = vi.fn()
    const view = render(ContextMenuTest, {
      props: { visible: false, x: 0, y: 0, onClose },
    })
    const trigger = screen.getByRole('button', { name: 'Menu trigger' })
    trigger.focus()

    await view.rerender({ visible: true, x: 0, y: 0, onClose })
    await tick()
    await fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Test Item' }), { key: 'Escape' })
    await tick()

    expect(onClose).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on Tab and lets browser focus navigation continue from the invoking control', async () => {
    const onClose = vi.fn()
    const view = render(ContextMenuTest, {
      props: { visible: false, x: 0, y: 0, onClose },
    })
    const trigger = screen.getByRole('button', { name: 'Menu trigger' })
    trigger.focus()

    await view.rerender({ visible: true, x: 0, y: 0, onClose })
    await tick()
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    screen.getByRole('menuitem', { name: 'Test Item' }).dispatchEvent(tabEvent)

    expect(onClose).toHaveBeenCalledOnce()
    expect(tabEvent.defaultPrevented).toBe(false)
    // jsdom does not perform Tab's default focus navigation. Chromium continues from this restored control.
    expect(document.activeElement).toBe(trigger)
  })

  it('describes a focused menu action and dismisses the nested tooltip before the menu', async () => {
    render(ContextMenuTest, { props: { visible: true, x: 0, y: 0, onClose: vi.fn() } })
    const menuItem = screen.getByRole('menuitem', { name: 'Danger Item' })

    menuItem.focus()
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe('Helpful context'))

    await fireEvent.keyDown(menuItem, { key: 'Escape' })

    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(document.activeElement).toBe(menuItem)
  })
})
