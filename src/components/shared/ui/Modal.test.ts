import { render, screen, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, it, expect, vi } from 'vitest'
import ModalTestWrapper from './ModalTestWrapper.svelte'

describe('Modal', () => {
  it('focuses the dialog by default when opened', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    await tick()

    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('focuses the requested element returned by initialFocus', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn(), initialFocusTarget: 'primary-button' } })

    await tick()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Primary action' }))
  })

  it('focuses the requested selector target when initialFocus is a selector', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn(), initialFocusTarget: 'input-selector' } })

    await tick()

    expect(document.activeElement).toBe(screen.getByLabelText('Modal input'))
  })

  it('falls back to dialog focus when initialFocus does not resolve a target', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn(), initialFocusTarget: 'missing-selector' } })

    await tick()

    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('applies an accessible dialog label when provided', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn(), ariaLabel: 'Switch project' } })

    expect(screen.getByRole('dialog', { name: 'Switch project' })).toBeTruthy()
  })

  it('can hide its default header chrome for palette-style dialogs', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn(), showHeader: false } })

    expect(screen.queryByRole('button', { name: '✕' })).toBeNull()
    expect(screen.getByText('Test content')).toBeTruthy()
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(ModalTestWrapper, { props: { onClose } })

    const dialog = screen.getByRole('dialog')
    await fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('stops propagation of Escape key events', async () => {
    const onClose = vi.fn()
    render(ModalTestWrapper, { props: { onClose } })

    const dialog = screen.getByRole('dialog')
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    const stopSpy = vi.spyOn(event, 'stopPropagation')

    dialog.dispatchEvent(event)

    expect(stopSpy).toHaveBeenCalled()
  })

  it('stops propagation of Enter key events so they do not reach parent handlers', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    const dialog = screen.getByRole('dialog')
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    const stopSpy = vi.spyOn(event, 'stopPropagation')

    dialog.dispatchEvent(event)

    expect(stopSpy).toHaveBeenCalled()
  })

  it('stops propagation of letter key events so vim navigation does not fire', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    const dialog = screen.getByRole('dialog')

    for (const key of ['j', 'k', 'g', 'G', 'x', 'h', 'l', 'q']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true })
      const stopSpy = vi.spyOn(event, 'stopPropagation')

      dialog.dispatchEvent(event)

      expect(stopSpy).toHaveBeenCalled()
    }
  })

  it('stops propagation of ArrowDown/ArrowUp key events', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    const dialog = screen.getByRole('dialog')

    for (const key of ['ArrowDown', 'ArrowUp']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true })
      const stopSpy = vi.spyOn(event, 'stopPropagation')

      dialog.dispatchEvent(event)

      expect(stopSpy).toHaveBeenCalled()
    }
  })

  it('does not stop propagation of modifier key combos (Cmd+T etc.)', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    const dialog = screen.getByRole('dialog')

    const metaEvent = new KeyboardEvent('keydown', { key: 't', metaKey: true, bubbles: true })
    const metaSpy = vi.spyOn(metaEvent, 'stopPropagation')
    dialog.dispatchEvent(metaEvent)
    expect(metaSpy).not.toHaveBeenCalled()

    const ctrlEvent = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })
    const ctrlSpy = vi.spyOn(ctrlEvent, 'stopPropagation')
    dialog.dispatchEvent(ctrlEvent)
    expect(ctrlSpy).not.toHaveBeenCalled()
  })

  it('restores focus to the pre-open control when unmounted', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Open dialog'
    document.body.append(opener)
    opener.focus()

    const view = render(ModalTestWrapper, { props: { onClose: vi.fn() } })
    await tick()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))

    view.unmount()

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('contains programmatic focus while mounted and restores focus when unmounted', async () => {
    const opener = document.createElement('button')
    const destination = document.createElement('button')
    document.body.append(opener, destination)
    opener.focus()

    const view = render(ModalTestWrapper, { props: { onClose: vi.fn() } })
    await tick()
    const dialog = screen.getByRole('dialog')

    destination.focus()
    expect(dialog.contains(document.activeElement)).toBe(true)

    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
    destination.remove()
  })

  it('calls onClose when the backdrop around the dialog box is clicked', async () => {
    const onClose = vi.fn()
    render(ModalTestWrapper, { props: { onClose } })

    await fireEvent.click(screen.getByRole('dialog'))

    expect(onClose).toHaveBeenCalled()
  })

  it('ignores a backdrop click when backdrop dismissal is off', async () => {
    const onClose = vi.fn()
    render(ModalTestWrapper, { props: { onClose, dismissOnBackdrop: false } })

    await fireEvent.click(screen.getByRole('dialog'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores a click inside the dialog box regardless of backdrop dismissal', async () => {
    const onClose = vi.fn()
    render(ModalTestWrapper, { props: { onClose } })

    await fireEvent.click(screen.getByText('Test content'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('still dismisses on Escape when backdrop dismissal is off', async () => {
    const onClose = vi.fn()
    render(ModalTestWrapper, { props: { onClose, dismissOnBackdrop: false } })

    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('still dismisses from the close control when backdrop dismissal is off', async () => {
    const onClose = vi.fn()
    render(ModalTestWrapper, { props: { onClose, dismissOnBackdrop: false } })

    await fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(onClose).toHaveBeenCalled()
  })
})
