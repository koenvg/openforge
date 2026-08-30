import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import ModalTestWrapper from './ModalTestWrapper.svelte'

describe('plugin-sdk Modal', () => {
  it('keeps ariaLabel compatible and focuses the dialog by default', async () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn() } })

    const dialog = screen.getByRole('dialog', { name: 'Plugin dialog' })

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Plugin dialog')
    expect(dialog.hasAttribute('aria-labelledby')).toBe(false)
    await tick()
    expect(document.activeElement).toBe(dialog)
  })

  it('can take its accessible name from labelled content', () => {
    render(ModalTestWrapper, { props: { onClose: vi.fn(), accessibleName: 'aria-labelledby' } })

    const dialog = screen.getByRole('dialog', { name: 'Plugin dialog' })

    expect(dialog.getAttribute('aria-labelledby')).toBe('plugin-dialog-title')
    expect(dialog.hasAttribute('aria-label')).toBe(false)
  })

  it.each([
    ['no naming prop', 'missing'],
    ['a blank ariaLabel', 'blank'],
    ['both naming props', 'both'],
  ] as const)('rejects %s', (_description, accessibleName) => {
    expect(() => render(ModalTestWrapper, { props: { onClose: vi.fn(), accessibleName } }))
      .toThrow('Modal requires exactly one non-empty accessible name prop: ariaLabel or ariaLabelledby')
  })

  it.each([
    ['references a missing element', 'dangling'],
    ['references content without text', 'empty-reference'],
  ] as const)('rejects ariaLabelledby that %s', (_description, accessibleName) => {
    expect(() => render(ModalTestWrapper, { props: { onClose: vi.fn(), accessibleName } }))
      .toThrow('Modal ariaLabelledby must reference at least one element with naming text')
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

  it('restores focus to the pre-open control when unmounted', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Open plugin dialog'
    document.body.append(opener)
    opener.focus()

    const view = render(ModalTestWrapper, { props: { onClose: vi.fn() } })
    await tick()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))

    view.unmount()

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('does not override focus deliberately moved outside before unmounting', async () => {
    const opener = document.createElement('button')
    const destination = document.createElement('button')
    document.body.append(opener, destination)
    opener.focus()

    const view = render(ModalTestWrapper, { props: { onClose: vi.fn() } })
    await tick()
    destination.focus()
    view.unmount()

    expect(document.activeElement).toBe(destination)
    opener.remove()
    destination.remove()
  })
})
