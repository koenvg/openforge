import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SearchPaletteTestWrapper from './SearchPaletteTestWrapper.svelte'

describe('SDK search palette', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(async () => {
    try {
      cleanup()
      await tick()
      // Bits UI releases the body scroll lock on a delayed callback after unmount.
      // Run it before JSDOM tears down this test's document.
      await vi.runAllTimersAsync()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders caller result information outside the selectable options', () => {
    render(SearchPaletteTestWrapper)
    const summary = screen.getByText('Showing top 3 results')
    expect(summary.closest('[role="option"]')).toBeNull()
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('filters through caller-owned query state and selects a result rather than its heading', async () => {
    const onSelect = vi.fn()
    render(SearchPaletteTestWrapper, { onSelect })
    const input = screen.getByRole('combobox')
    expect(screen.getByText('Suggestions')).toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(3)
    await fireEvent.input(input, { target: { value: 'be' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option').id)
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Beta')
  })

  it.each(['ArrowDown', 'n', 'j'])('navigates with %s and activates exactly once', async (key) => {
    const onSelect = vi.fn()
    render(SearchPaletteTestWrapper, { onSelect })
    const input = screen.getByRole('combobox')
    await fireEvent.keyDown(input, { key, ctrlKey: key.length === 1 })
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id)
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Beta')
  })

  it('does not activate stale results while loading or empty', async () => {
    const onSelect = vi.fn()
    const { rerender } = render(SearchPaletteTestWrapper, { onSelect })
    await rerender({ loading: true })
    const input = screen.getByRole('combobox')
    expect(screen.getByRole('status').textContent).toContain('Loading results')
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    await fireEvent.keyDown(input, { key: 'Enter' })
    await rerender({ loading: false })
    await fireEvent.input(input, { target: { value: 'no match' } })
    expect(screen.getByRole('status').textContent).toContain('No matching results')
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps option identities separate across instances and supports pointer selection', async () => {
    const onSelect = vi.fn()
    render(SearchPaletteTestWrapper, { onSelect })
    render(SearchPaletteTestWrapper)
    const options = screen.getAllByRole('option')
    expect(new Set(options.map(option => option.id)).size).toBe(6)
    await fireEvent.click(options[1])
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Beta')
  })

  it('replaces results with caller content, owns Escape, and restores search focus', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(SearchPaletteTestWrapper, { onSelect, onClose })
    await rerender({ alternate: true })
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    expect(document.activeElement).toBe(confirm)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('option')).toBeNull()
    await fireEvent.keyDown(confirm, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
    await fireEvent.keyDown(confirm, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    await rerender({ alternate: false })
    expect(document.activeElement).toBe(screen.getByRole('combobox'))
  })

  it.each(['Escape', 'backdrop'])('requests dismissal once through %s', async (method) => {
    const onClose = vi.fn()
    render(SearchPaletteTestWrapper, { onClose })
    if (method === 'Escape') await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    else await fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
