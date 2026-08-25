import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import BoardTextFilter from './BoardTextFilter.svelte'

const defaultProps = {
  query: '',
  matchingCount: 0,
  shortcutBlocked: false,
  onBoardKeydown: vi.fn(),
}

describe('BoardTextFilter', () => {
  it('opens and focuses the filter when the user presses slash', async () => {
    render(BoardTextFilter, { props: defaultProps })

    await fireEvent.keyDown(window, { key: '/' })

    const input = await screen.findByRole('searchbox', { name: 'Filter tasks' })
    expect(document.activeElement).toBe(input)
  })

  it('applies the query on Enter and exposes edit and clear controls', async () => {
    render(BoardTextFilter, { props: { ...defaultProps, matchingCount: 2 } })

    await fireEvent.keyDown(window, { key: '/' })
    const input = await screen.findByRole('searchbox', { name: 'Filter tasks' })
    await fireEvent.input(input, { target: { value: 'focus' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.queryByRole('searchbox', { name: 'Filter tasks' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit task filter: focus' })).toBeTruthy()
    expect(screen.getByText('2 matching')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear task filter' })).toBeTruthy()
  })

  it('keeps the Enter used to commit the filter from reaching board shortcuts', async () => {
    render(BoardTextFilter, { props: defaultProps })

    await fireEvent.keyDown(window, { key: '/' })
    const input = await screen.findByRole('searchbox', { name: 'Filter tasks' })
    await fireEvent.input(input, { target: { value: 'focus' } })
    const boardShortcut = vi.fn()
    window.addEventListener('keydown', boardShortcut)

    await fireEvent.keyDown(input, { key: 'Enter' })

    window.removeEventListener('keydown', boardShortcut)
    expect(boardShortcut).not.toHaveBeenCalled()
  })

  it('clears an applied query when the user presses Escape', async () => {
    render(BoardTextFilter, { props: { ...defaultProps, query: 'focus' } })

    await fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('button', { name: 'Clear task filter' })).toBeNull()
  })

  it('leaves keyboard events alone while an editable control owns focus', async () => {
    const onBoardKeydown = vi.fn()
    render(BoardTextFilter, { props: { ...defaultProps, onBoardKeydown } })
    const editor = document.createElement('textarea')
    document.body.append(editor)
    editor.focus()

    await fireEvent.keyDown(window, { key: '/' })

    expect(screen.queryByRole('searchbox', { name: 'Filter tasks' })).toBeNull()
    expect(onBoardKeydown).not.toHaveBeenCalled()
    editor.remove()
  })
})
