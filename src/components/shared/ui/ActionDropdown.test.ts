import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { Action } from '../../../lib/types'
import ActionDropdown from './ActionDropdown.svelte'

const actions: Action[] = [
  { id: 'primary', name: 'Primary Action', prompt: 'Primary prompt', builtin: false, enabled: true },
  { id: 'disabled', name: 'Disabled Action', prompt: 'Disabled prompt', builtin: false, enabled: false },
  { id: 'secondary', name: 'Secondary Action', prompt: 'Secondary prompt', builtin: false, enabled: true },
]

describe('ActionDropdown', () => {
  it('opens a semantic menu, focuses its first enabled item, and contains Escape', async () => {
    const onDocumentKeydown = vi.fn()
    render(ActionDropdown, { props: { actions, onAction: vi.fn() } })
    const trigger = screen.getByRole('button', { name: 'More actions' })
    await fireEvent.click(trigger)

    expect(screen.getByRole('menu')).toBeTruthy()
    const firstEnabledItem = screen.getByRole('menuitem', { name: 'Secondary Action' })
    await waitFor(() => expect(document.activeElement).toBe(firstEnabledItem))

    document.addEventListener('keydown', onDocumentKeydown)
    await fireEvent.keyDown(firstEnabledItem, { key: 'Escape' })
    document.removeEventListener('keydown', onDocumentKeydown)

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(onDocumentKeydown).not.toHaveBeenCalled()
  })

  it('closes on an outside pointer and restores focus to the trigger', async () => {
    render(ActionDropdown, { props: { actions, onAction: vi.fn() } })
    const trigger = screen.getByRole('button', { name: 'More actions' })
    await fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()

    await fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes and invokes the selected action while preserving the primary split action', async () => {
    const onAction = vi.fn()
    render(ActionDropdown, { props: { actions, onAction } })

    await fireEvent.click(screen.getByRole('button', { name: 'Primary Action' }))
    expect(onAction).toHaveBeenLastCalledWith(actions[0])

    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Secondary Action' }))

    expect(onAction).toHaveBeenLastCalledWith(actions[2])
    expect(onAction).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not open from a disabled trigger', async () => {
    render(ActionDropdown, { props: { actions, disabled: true, onAction: vi.fn() } })
    const trigger = screen.getByRole('button', { name: 'More actions' })

    expect((trigger as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(trigger)

    expect(screen.queryByRole('menu')).toBeNull()
  })
})
