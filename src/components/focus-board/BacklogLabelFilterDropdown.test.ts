import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { TaskLabel } from '../../lib/types'
import BacklogLabelFilterDropdown from './BacklogLabelFilterDropdown.svelte'

const bugLabel: TaskLabel = { id: 1, projectId: 'proj-1', name: 'bug' }
const uiLabel: TaskLabel = { id: 2, projectId: 'proj-1', name: 'ui' }
const labels = [bugLabel, uiLabel]
const labelCounts = new Map([[bugLabel.id, 3], [uiLabel.id, 2]])

describe('BacklogLabelFilterDropdown', () => {
  it('shows checked options, Task counts, and the selected-label count', async () => {
    render(BacklogLabelFilterDropdown, {
      props: {
        labels,
        labelCounts,
        selectedLabelIds: new Set([bugLabel.id]),
        onToggle: vi.fn(),
      },
    })

    const trigger = screen.getByRole('button', { name: 'Filter by Task Labels' })
    expect(trigger.textContent).toContain('Labels')
    expect(trigger.textContent).toContain('1')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    await fireEvent.click(trigger)

    const bugOption = screen.getByRole('menuitemcheckbox', { name: /bug 3/i })
    const uiOption = screen.getByRole('menuitemcheckbox', { name: /ui 2/i })
    expect(bugOption.getAttribute('aria-checked')).toBe('true')
    expect(uiOption.getAttribute('aria-checked')).toBe('false')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('emits every toggle immediately and keeps the menu open for multiple selections', async () => {
    const onToggle = vi.fn()
    render(BacklogLabelFilterDropdown, {
      props: {
        labels,
        labelCounts,
        selectedLabelIds: new Set([bugLabel.id]),
        onToggle,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Filter by Task Labels' }))
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /ui 2/i }))
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /bug 3/i }))

    expect(onToggle).toHaveBeenNthCalledWith(1, uiLabel.id)
    expect(onToggle).toHaveBeenNthCalledWith(2, bugLabel.id)
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('supports menu navigation keys and toggles the focused checked item without closing', async () => {
    const onToggle = vi.fn()
    render(BacklogLabelFilterDropdown, {
      props: {
        labels,
        labelCounts,
        selectedLabelIds: new Set([bugLabel.id]),
        onToggle,
      },
    })

    const trigger = screen.getByRole('button', { name: 'Filter by Task Labels' })
    trigger.focus()
    await fireEvent.keyDown(trigger, { key: 'Enter' })

    const bugOption = await screen.findByRole('menuitemcheckbox', { name: /bug 3/i })
    const uiOption = screen.getByRole('menuitemcheckbox', { name: /ui 2/i })
    await waitFor(() => expect(document.activeElement).toBe(bugOption))
    expect(bugOption.tabIndex).toBe(-1)
    expect(uiOption.tabIndex).toBe(-1)

    await fireEvent.keyDown(bugOption, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(uiOption)
    await fireEvent.keyDown(uiOption, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(bugOption)
    await fireEvent.keyDown(bugOption, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(uiOption)
    await fireEvent.keyDown(uiOption, { key: 'Home' })
    expect(document.activeElement).toBe(bugOption)
    await fireEvent.keyDown(bugOption, { key: 'End' })
    expect(document.activeElement).toBe(uiOption)

    await fireEvent.keyDown(uiOption, { key: ' ' })

    expect(onToggle).toHaveBeenCalledWith(uiLabel.id)
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('moves focus to the nearest remaining option when the focused label disappears', async () => {
    const onToggle = vi.fn()
    const view = render(BacklogLabelFilterDropdown, {
      props: {
        labels,
        labelCounts,
        selectedLabelIds: new Set(),
        onToggle,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Filter by Task Labels' }))
    const bugOption = screen.getByRole('menuitemcheckbox', { name: /bug 3/i })
    await waitFor(() => expect(document.activeElement).toBe(bugOption))

    await view.rerender({
      labels: [uiLabel],
      labelCounts: new Map([[uiLabel.id, 2]]),
      selectedLabelIds: new Set(),
      onToggle,
    })

    expect(screen.queryByRole('menuitemcheckbox', { name: /bug 3/i })).toBeNull()
    expect(screen.getByRole('menu')).toBeTruthy()
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('menuitemcheckbox', { name: /ui 2/i }))
    })
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    render(BacklogLabelFilterDropdown, {
      props: {
        labels,
        labelCounts,
        selectedLabelIds: new Set(),
        onToggle: vi.fn(),
      },
    })

    const trigger = screen.getByRole('button', { name: 'Filter by Task Labels' })
    await fireEvent.click(trigger)
    const bugOption = await screen.findByRole('menuitemcheckbox', { name: /bug 3/i })
    await waitFor(() => expect(document.activeElement).toBe(bugOption))

    await fireEvent.keyDown(bugOption, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
