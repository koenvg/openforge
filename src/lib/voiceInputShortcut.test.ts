import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerVoiceInputShortcutTarget,
  toggleVoiceInputShortcut,
} from './voiceInputShortcut'

const unregisterTargets: Array<() => void> = []

function createModal(): HTMLDivElement {
  const modal = document.createElement('div')
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  return modal
}

afterEach(() => {
  unregisterTargets.splice(0).forEach((unregister) => unregister())
  document.body.replaceChildren()
})

describe('voice input shortcut', () => {
  it('toggles only the most recently registered enabled target', () => {
    const firstToggle = vi.fn()
    const secondToggle = vi.fn()
    const firstRoot = document.createElement('div')
    const secondRoot = document.createElement('div')
    document.body.append(firstRoot, secondRoot)

    unregisterTargets.push(
      registerVoiceInputShortcutTarget({
        root: firstRoot,
        isEnabled: () => true,
        toggle: firstToggle,
      }),
      registerVoiceInputShortcutTarget({
        root: secondRoot,
        isEnabled: () => true,
        toggle: secondToggle,
      }),
    )

    expect(toggleVoiceInputShortcut()).toBe(true)
    expect(firstToggle).not.toHaveBeenCalled()
    expect(secondToggle).toHaveBeenCalledOnce()
  })

  it('prefers a target in the topmost modal over an underlying target', () => {
    const modalToggle = vi.fn()
    const underlyingToggle = vi.fn()
    const modal = createModal()
    const modalRoot = document.createElement('div')
    const underlyingRoot = document.createElement('div')
    modal.append(modalRoot)
    document.body.append(underlyingRoot, modal)

    unregisterTargets.push(
      registerVoiceInputShortcutTarget({
        root: modalRoot,
        isEnabled: () => true,
        toggle: modalToggle,
      }),
      registerVoiceInputShortcutTarget({
        root: underlyingRoot,
        isEnabled: () => true,
        toggle: underlyingToggle,
      }),
    )

    expect(toggleVoiceInputShortcut()).toBe(true)
    expect(modalToggle).toHaveBeenCalledOnce()
    expect(underlyingToggle).not.toHaveBeenCalled()
  })

  it('does not fall through to an obscured target when the topmost modal has no voice input', () => {
    const underlyingToggle = vi.fn()
    const underlyingRoot = document.createElement('div')
    const modal = createModal()
    document.body.append(underlyingRoot, modal)

    unregisterTargets.push(registerVoiceInputShortcutTarget({
      root: underlyingRoot,
      isEnabled: () => true,
      toggle: underlyingToggle,
    }))

    expect(toggleVoiceInputShortcut()).toBe(false)
    expect(underlyingToggle).not.toHaveBeenCalled()
  })

  it('prefers the target containing focus over a later registered target', () => {
    const focusedToggle = vi.fn()
    const laterToggle = vi.fn()
    const focusedRoot = document.createElement('div')
    const focusTarget = document.createElement('button')
    const laterRoot = document.createElement('div')
    focusedRoot.append(focusTarget)
    document.body.append(focusedRoot, laterRoot)

    unregisterTargets.push(
      registerVoiceInputShortcutTarget({
        root: focusedRoot,
        isEnabled: () => true,
        toggle: focusedToggle,
      }),
      registerVoiceInputShortcutTarget({
        root: laterRoot,
        isEnabled: () => true,
        toggle: laterToggle,
      }),
    )
    focusTarget.focus()

    expect(toggleVoiceInputShortcut()).toBe(true)
    expect(focusedToggle).toHaveBeenCalledOnce()
    expect(laterToggle).not.toHaveBeenCalled()
  })

  it('skips a hidden target in favor of a visible target', () => {
    const visibleToggle = vi.fn()
    const hiddenToggle = vi.fn()
    const visibleRoot = document.createElement('div')
    const hiddenContainer = document.createElement('div')
    const hiddenRoot = document.createElement('div')
    hiddenContainer.style.display = 'none'
    hiddenContainer.append(hiddenRoot)
    document.body.append(visibleRoot, hiddenContainer)

    unregisterTargets.push(
      registerVoiceInputShortcutTarget({
        root: visibleRoot,
        isEnabled: () => true,
        toggle: visibleToggle,
      }),
      registerVoiceInputShortcutTarget({
        root: hiddenRoot,
        isEnabled: () => true,
        toggle: hiddenToggle,
      }),
    )

    expect(toggleVoiceInputShortcut()).toBe(true)
    expect(visibleToggle).toHaveBeenCalledOnce()
    expect(hiddenToggle).not.toHaveBeenCalled()
  })

  it('falls back to the previous target after the selected target unregisters', () => {
    const previousToggle = vi.fn()
    const selectedToggle = vi.fn()
    const previousRoot = document.createElement('div')
    const selectedRoot = document.createElement('div')
    document.body.append(previousRoot, selectedRoot)

    unregisterTargets.push(registerVoiceInputShortcutTarget({
      root: previousRoot,
      isEnabled: () => true,
      toggle: previousToggle,
    }))
    const unregisterSelected = registerVoiceInputShortcutTarget({
      root: selectedRoot,
      isEnabled: () => true,
      toggle: selectedToggle,
    })
    unregisterTargets.push(unregisterSelected)

    expect(toggleVoiceInputShortcut()).toBe(true)
    expect(selectedToggle).toHaveBeenCalledOnce()

    unregisterSelected()
    expect(toggleVoiceInputShortcut()).toBe(true)
    expect(previousToggle).toHaveBeenCalledOnce()
  })

  it('routes to the last modal in DOM order when multiple modals are open', () => {
    const firstModalToggle = vi.fn()
    const topmostModalToggle = vi.fn()
    const firstModal = createModal()
    const topmostModal = createModal()
    const firstRoot = document.createElement('div')
    const topmostRoot = document.createElement('div')
    firstModal.append(firstRoot)
    topmostModal.append(topmostRoot)
    document.body.append(firstModal, topmostModal)

    unregisterTargets.push(
      registerVoiceInputShortcutTarget({
        root: topmostRoot,
        isEnabled: () => true,
        toggle: topmostModalToggle,
      }),
      registerVoiceInputShortcutTarget({
        root: firstRoot,
        isEnabled: () => true,
        toggle: firstModalToggle,
      }),
    )

    expect(toggleVoiceInputShortcut()).toBe(true)
    expect(topmostModalToggle).toHaveBeenCalledOnce()
    expect(firstModalToggle).not.toHaveBeenCalled()
  })
})
