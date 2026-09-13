import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import PaletteListboxTestWrapper from './PaletteListboxTestWrapper.svelte'

describe('SDK inline palette listbox', () => {
  it('keeps focus in the prompt, clamps navigation, and activates the selected suggestion', async () => {
    const onSelect = vi.fn()
    render(PaletteListboxTestWrapper, { onSelect })
    const input = screen.getByRole('combobox')
    input.focus()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id)
    await fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id)
    for (let i = 0; i < 4; i++) await fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[2].id)
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Gamma')
    expect(document.activeElement).toBe(input)
  })

  it('does not activate hidden, loading, or empty suggestions and only consumes Escape when owned', async () => {
    const onSelect = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(PaletteListboxTestWrapper, { onSelect })
    const input = screen.getByRole('combobox')
    expect(await fireEvent.keyDown(input, { key: 'Escape' })).toBe(true)
    for (const state of [{ visible: false }, { visible: true, loading: true }, { loading: false, items: [] }]) {
      await rerender(state)
      expect(input.getAttribute('aria-activedescendant')).toBeNull()
      expect(screen.queryByRole('option')).toBeNull()
      expect(await fireEvent.keyDown(input, { key: 'Enter' })).toBe(true)
    }
    expect(screen.getByRole('status').textContent).toContain('No suggestions')
    expect(onSelect).not.toHaveBeenCalled()
    await rerender({ onCancel })
    expect(await fireEvent.keyDown(input, { key: 'Escape' })).toBe(false)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('uses unique IDs per instance and activates a pointer or focused option without moving input focus', async () => {
    const onSelect = vi.fn()
    render(PaletteListboxTestWrapper, { onSelect })
    render(PaletteListboxTestWrapper)
    const options = screen.getAllByRole('option')
    expect(new Set(options.map(option => option.id)).size).toBe(6)
    const input = screen.getAllByRole('combobox')[0]
    input.focus()
    expect(await fireEvent.mouseDown(options[1])).toBe(false)
    await fireEvent.click(options[1])
    expect(document.activeElement).toBe(input)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Beta')
    onSelect.mockClear()
    await fireEvent.keyDown(options[2], { key: ' ' })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('Gamma')
  })

  it('wraps when requested and keeps stable option IDs across result reordering', async () => {
    const { rerender } = render(PaletteListboxTestWrapper, { wrap: true })
    const input = screen.getByRole('combobox')
    const alphaId = screen.getByRole('option', { name: 'Alpha' }).id
    await fireEvent.keyDown(input, { key: 'k', ctrlKey: true })
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Gamma' }).id)
    await fireEvent.keyDown(input, { key: 'n', ctrlKey: true })
    expect(input.getAttribute('aria-activedescendant')).toBe(alphaId)
    await rerender({ items: ['Beta', 'Alpha'] })
    expect(screen.getByRole('option', { name: 'Alpha' }).id).toBe(alphaId)
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Beta' }).id)
  })
})
