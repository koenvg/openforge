import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandHeld, focusBoardFilters } from '../../lib/stores'
import FocusBoard from './FocusBoard.svelte'

function renderHeader(overrides: { onNewTask?: () => void, onOpenCommandSearch?: () => void } = {}) {
  return render(FocusBoard, {
    props: {
      projectId: null,
      projectName: 'Test Project',
      tasks: [],
      activeSessions: new Map(),
      ticketPrs: new Map(),
      onOpenTask: vi.fn(),
      onRunAction: vi.fn(),
      ...overrides,
    },
  })
}

describe('FocusBoard header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    commandHeld.set(false)
    focusBoardFilters.set(new Map())
  })

  afterEach(cleanup)

  it('renders the project name as the board heading', async () => {
    renderHeader()

    expect(await screen.findByRole('heading', { name: 'Test Project' })).toBeTruthy()
  })

  it('opens command search and Create Task from stable actions', async () => {
    const onNewTask = vi.fn()
    const onOpenCommandSearch = vi.fn()
    renderHeader({ onNewTask, onOpenCommandSearch })

    await fireEvent.click(await screen.findByRole('button', { name: 'Search tasks or use a command' }))
    await fireEvent.click(screen.getByRole('button', { name: 'New task' }))

    expect(onOpenCommandSearch).toHaveBeenCalledOnce()
    expect(onNewTask).toHaveBeenCalledOnce()
  })

  it('shows the New task shortcut only while Command is held', async () => {
    renderHeader()

    expect(screen.queryByText('⌘N')).toBeNull()

    commandHeld.set(true)

    expect(await screen.findByText('⌘N')).toBeTruthy()

    commandHeld.set(false)

    await vi.waitFor(() => expect(screen.queryByText('⌘N')).toBeNull())
  })

  it('marks Focus as the default active filter', async () => {
    renderHeader()

    const chip = await screen.findByRole('button', { name: /^Focus 0$/i })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('orders the board filters by lifecycle', async () => {
    renderHeader()

    const labels = (await screen.findAllByRole('button'))
      .map((button) => button.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter((label) => /^(Focus|In Flight|Out of Focus|Backlog)\b/.test(label))
      .map((label) => label.replace(/ \d+.*$/, ''))

    expect(labels.slice(0, 4)).toEqual(['Focus', 'In Flight', 'Out of Focus', 'Backlog'])
  })
})
