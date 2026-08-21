import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import AppShortcutHelpDialog from './AppShortcutHelpDialog.svelte'
import { useAppShortcutHelpController } from '../../lib/appShortcutHelpController.svelte'

describe('AppShortcutHelpDialog', () => {
  it('opens and closes through its controller while returning focus to the previous control', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Shortcut help'
    document.body.appendChild(trigger)
    trigger.focus()

    const controller = useAppShortcutHelpController()
    render(AppShortcutHelpDialog, {
      controller,
      taskSelected: false,
      boardVisible: true,
    })

    expect(screen.queryByRole('dialog')).toBeNull()

    controller.open()

    const dialog = await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })
    await waitFor(() => {
      expect(document.activeElement).toBe(dialog)
    })
    expect(screen.getByText('Board')).toBeTruthy()
    expect(screen.queryByText('Task view')).toBeNull()

    await fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('shows task shortcuts instead of board shortcuts when a task is selected', async () => {
    const controller = useAppShortcutHelpController()
    controller.open()

    render(AppShortcutHelpDialog, {
      controller,
      taskSelected: true,
      boardVisible: false,
    })

    const dialog = screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })
    expect(screen.getByText('Task view')).toBeTruthy()
    expect(screen.queryByText('Board')).toBeNull()
    expect(dialog.textContent?.replace(/\s+/g, '')).toContain('Attentionoverview⌘Eor⌘;')
  })

  it('exposes visibility state so conflicting shell shortcuts can stay disabled', () => {
    const controller = useAppShortcutHelpController()

    expect(controller.isOpen).toBe(false)
    controller.open()
    expect(controller.isOpen).toBe(true)
    controller.close()
    expect(controller.isOpen).toBe(false)
  })
})
