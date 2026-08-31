import { fireEvent, screen, waitFor, within } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as taskIpc from '../../lib/ipc'
import { commandHeld, lastViewedTaskId } from '../../lib/stores'
import {
  getCurrentVimItem,
  makeSession,
  onOpenTask,
  renderBoard,
  resetFocusBoardTestState,
  taskDoing,
  taskDone,
  taskFocus,
} from './FocusBoard.test-utils'

describe('FocusBoard keyboard and selection interaction', () => {
  beforeEach(resetFocusBoardTestState)

  it('auto-selects the focused task in detail pane on mount', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })
    const detailPane = screen.getByTestId('task-info-panel')
    expect(within(detailPane).getByText('Initial Prompt')).toBeTruthy()
    expect(within(detailPane).getByRole('region', { name: 'Initial Prompt content' }).textContent).toContain('Focus task')
  })

  it('switches inspector selection from active data without detail reads or loading placeholders', async () => {
    const detailRead = vi.spyOn(taskIpc, 'readTaskDetail')
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'running', null)],
      ]),
    })

    await waitFor(() => {
      expect(within(screen.getByTestId('task-info-panel')).getByText('Focus task')).toBeTruthy()
    })
    await fireEvent.keyDown(window, { key: 'j' })
    await fireEvent.click(await screen.findByRole('button', { name: /In Flight 1/i }))
    const doingRow = screen.getAllByText('Doing task')[0].closest('[data-vim-item]')
    expect(doingRow).toBeTruthy()
    await fireEvent.click(doingRow as HTMLElement)
    await waitFor(() => {
      expect(within(screen.getByTestId('task-info-panel')).getByText('Doing task')).toBeTruthy()
    })

    expect(detailRead).not.toHaveBeenCalled()
    expect(screen.queryByText(/Loading task/i)).toBeNull()
  })

  it('moves vim focus down on j key', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(getCurrentVimItem().getAttribute('aria-current')).toBe('true')
    })

    await fireEvent.keyDown(window, { key: 'j' })

    const currentItem = getCurrentVimItem()
    expect(currentItem.getAttribute('aria-current')).toBe('true')
    expect(within(currentItem).getByText('Doing task')).toBeTruthy()

    await fireEvent.keyDown(window, { key: 'Enter' })
    expect(onOpenTask).toHaveBeenCalledWith('T-2')
  })

  it('moves board focus down on ArrowDown key', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(getCurrentVimItem().getAttribute('aria-current')).toBe('true')
    })

    await fireEvent.keyDown(window, { key: 'ArrowDown' })

    const currentItem = getCurrentVimItem()
    expect(currentItem.getAttribute('aria-current')).toBe('true')
    expect(within(currentItem).getByText('Doing task')).toBeTruthy()
  })

  it('moves vim focus up on k key', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await fireEvent.keyDown(window, { key: 'j' })
    await fireEvent.keyDown(window, { key: 'k' })

    const currentItem = getCurrentVimItem()
    expect(currentItem.getAttribute('aria-current')).toBe('true')
    expect(within(currentItem).getByText('Focus task')).toBeTruthy()

    await fireEvent.keyDown(window, { key: 'Enter' })
    expect(onOpenTask).toHaveBeenCalledWith('T-1')
  })

  it('moves board focus up on ArrowUp key', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await fireEvent.keyDown(window, { key: 'j' })
    await fireEvent.keyDown(window, { key: 'ArrowUp' })

    const currentItem = getCurrentVimItem()
    expect(currentItem.getAttribute('aria-current')).toBe('true')
    expect(within(currentItem).getByText('Focus task')).toBeTruthy()
  })

  it('does not move board focus with ArrowDown while the detail pane has focus', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    const openFullViewButton = await screen.findByRole('button', { name: 'Open full view' })
    await fireEvent.focusIn(openFullViewButton)
    await fireEvent.keyDown(window, { key: 'ArrowDown' })

    const currentItem = getCurrentVimItem()
    expect(within(currentItem).getByText('Focus task')).toBeTruthy()
  })

  it('opens focused task on Enter', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.getAllByText('Focus task').length).toBeGreaterThan(0)
    })
    await fireEvent.keyDown(window, { key: 'Enter' })
    expect(onOpenTask).toHaveBeenCalledWith('T-1')
  })

  it('calls onOpenTask when Enter is pressed on already-selected task', async () => {
    renderBoard()

    await fireEvent.keyDown(window, { key: 'Enter' })
    await fireEvent.keyDown(window, { key: 'Enter' })

    expect(onOpenTask).toHaveBeenCalledWith('T-1')
  })

  it('closes detail pane on Escape', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })

    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Select a task to see details')).toBeTruthy()
  })

  it('auto-selects task in detail pane when vim j is pressed', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing, taskDone],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
      prs: new Map(),
    })

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })

    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('Select a task to see details')).toBeTruthy()

    await fireEvent.keyDown(window, { key: 'j' })
    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })
  })

  it('opens task context menu on right click', async () => {
    renderBoard()

    await fireEvent.click(await screen.findByRole('button', { name: /In Flight 1/i }))
    const doingTaskElements = screen.getAllByText('Doing task')
    await fireEvent.contextMenu(doingTaskElements[0])

    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByText(/Complete/)).toBeTruthy()
  })

  it('shows backlog task in detail pane when switching to Backlog filter', async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.queryByText('Select a task to see details')).toBeNull()
    })

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    expect(screen.getAllByText('Backlog task').length).toBeGreaterThan(0)
    expect(screen.queryByText('Focus task')).toBeNull()
  })

  it('CMD+1 activates Focus filter', async () => {
    renderBoard()
    // First switch away from focus
    await fireEvent.click(await screen.findByRole('button', { name: /In Flight/i }))
    // Now CMD+1 should switch back
    await fireEvent.keyDown(window, { key: '1', metaKey: true })
    const focusChip = screen.getByRole('button', { name: /^Focus 1$/i })
    expect(focusChip.getAttribute('aria-pressed')).toBe('true')
  })

  it('CMD+2 activates In Flight filter', async () => {
    renderBoard()
    await fireEvent.keyDown(window, { key: '2', metaKey: true })
    const chip = screen.getByRole('button', { name: /In Flight 1/i })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('CMD+3 activates Out of Focus filter', async () => {
    renderBoard()
    await fireEvent.keyDown(window, { key: '3', metaKey: true })
    const chip = screen.getByRole('button', { name: /Out of Focus 0/i })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('CMD+4 activates Backlog filter', async () => {
    renderBoard()
    await fireEvent.keyDown(window, { key: '4', metaKey: true })
    const chip = screen.getByRole('button', { name: /Backlog 1/i })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('shows filter shortcut hints when Command is held', async () => {
    renderBoard()

    expect(screen.queryByText('⌘1')).toBeNull()
    expect(screen.queryByText('⌘2')).toBeNull()
    expect(screen.queryByText('⌘3')).toBeNull()
    expect(screen.queryByText('⌘4')).toBeNull()

    commandHeld.set(true)

    expect(await screen.findByText('⌘1')).toBeTruthy()
    expect(screen.getByText('⌘2')).toBeTruthy()
    expect(screen.getByText('⌘3')).toBeTruthy()
    expect(screen.getByText('⌘4')).toBeTruthy()
  })

  it('clicking an unselected task selects it without navigating', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const items = document.querySelectorAll('[data-vim-item]')
    await fireEvent.click(items[1])

    expect(onOpenTask).not.toHaveBeenCalled()

    await waitFor(() => {
      const updatedItems = document.querySelectorAll('[data-vim-item]')
      expect(updatedItems[1].getAttribute('data-selected')).toBe('true')
    })
  })

  it('clicking an already-selected task navigates to it', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const items = document.querySelectorAll('[data-vim-item]')

    await fireEvent.click(items[1])
    expect(onOpenTask).not.toHaveBeenCalled()

    await fireEvent.click(items[1])
    expect(onOpenTask).toHaveBeenCalledWith(taskDoing.id)
  })

  it('marks only the just-viewed task card with data-just-viewed', async () => {
    lastViewedTaskId.set(taskFocus.id)

    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const items = Array.from(document.querySelectorAll('[data-vim-item]')) as HTMLElement[]
    const focusCard = items.find((item) => within(item).queryByText('Focus task'))
    const doingCard = items.find((item) => within(item).queryByText('Doing task'))

    expect(focusCard).toBeTruthy()
    expect(doingCard).toBeTruthy()
    expect(focusCard!.getAttribute('data-just-viewed')).toBe('true')
    expect(doingCard!.getAttribute('data-just-viewed')).toBeNull()
  })

  it('selects the just-viewed task on return to the board', async () => {
    lastViewedTaskId.set(taskDoing.id)

    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const current = getCurrentVimItem()
    expect(within(current).queryByText('Doing task')).toBeTruthy()
    expect(within(current).queryByText('Focus task')).toBeNull()
  })

  it('keeps the first card selected when there is no just-viewed task', async () => {
    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    const current = getCurrentVimItem()
    expect(within(current).queryByText('Focus task')).toBeTruthy()
  })

  it('clears lastViewedTaskId after the board mounts so the pop does not replay', async () => {
    lastViewedTaskId.set(taskFocus.id)

    renderBoard({
      tasks: [taskFocus, taskDoing],
      sessions: new Map([
        [taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')],
        [taskDoing.id, makeSession(taskDoing.id, 'failed', null)],
      ]),
    })

    await waitFor(() => {
      expect(document.querySelectorAll('[data-vim-item]').length).toBe(2)
    })

    expect(get(lastViewedTaskId)).toBeNull()
  })

  it('keeps Command filter shortcuts active while the detail pane has focus', async () => {
    renderBoard()
    const openFullViewButton = await screen.findByRole('button', { name: 'Open full view' })

    await fireEvent.focusIn(openFullViewButton)
    await fireEvent.keyDown(window, { key: '4', metaKey: true })

    expect(screen.getByRole('button', { name: /Backlog 1/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the task context menu at the pointer coordinates', async () => {
    renderBoard()
    await fireEvent.click(await screen.findByRole('button', { name: /In Flight 1/i }))
    const doingTask = (await screen.findAllByText('Doing task'))[0]

    await fireEvent.contextMenu(doingTask, { clientX: 137, clientY: 241 })

    expect(screen.getByRole('menu').getAttribute('style')).toContain('left: 137px; top: 241px;')
  })
})
