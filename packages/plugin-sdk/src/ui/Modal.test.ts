import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import ModalTestWrapper from './ModalTestWrapper.svelte'

describe('plugin-sdk Modal', () => {
  it('renders a named modal dialog and focuses the dialog by default', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    const dialog = screen.getByRole('dialog', { name: 'Plugin dialog' })

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    await tick()
    expect(document.activeElement).toBe(dialog)
  })

  it('supports caller-selected initial focus', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn(), initialFocus: '[data-testid="first-field"]' } })

    await tick()

    expect(document.activeElement).toBe(screen.getByTestId('first-field'))
  })

  it('closes on Escape and backdrop click', async () => {
    const onClose = vi.fn()
    render(ModalTestWrapper, { props: { onClose } })

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    await fireEvent.click(dialog)

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('honors closeDisabled for Escape, backdrop, and close button', async () => {
    const onClose = vi.fn()
    render(ModalTestWrapper, { props: { onClose, closeDisabled: true } })

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'Escape' })
    await fireEvent.click(dialog)
    await fireEvent.click(screen.getByRole('button', { name: 'Close plugin dialog' }))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('lets caller key handling consume keys before default Escape close', async () => {
    const onClose = vi.fn()
    const onKeydown = vi.fn((event: KeyboardEvent) => event.key === 'Escape')
    render(ModalTestWrapper, { props: { onClose, onKeydown } })

    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onKeydown).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('traps Tab focus inside the dialog', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    const dialog = screen.getByRole('dialog')
    const closeButton = screen.getByRole('button', { name: 'Close plugin dialog' })
    const last = screen.getByRole('button', { name: 'Last action' })

    last.focus()
    await fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)

    closeButton.focus()
    await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})
