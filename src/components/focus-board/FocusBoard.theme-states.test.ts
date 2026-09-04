import { cleanup, fireEvent, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import { DARK_THEME, LIGHT_THEME, type ThemeDefinition } from '../../lib/themeContract'
import { createThemeDocumentAdapter } from '../../lib/themeDocumentAdapter'
import {
  renderBoard,
  resetFocusBoardTestState,
  taskBacklog,
  taskFocus,
} from './FocusBoard.test-utils'

const BUILT_IN_THEMES = [LIGHT_THEME, DARK_THEME] as const

function expectTokenClass(element: Element, className: string, property: string, value: string) {
  expect(element.classList.contains(className)).toBe(true)
  expect(document.documentElement.style.getPropertyValue(property)).toBe(value)
}

describe.each(BUILT_IN_THEMES)('FocusBoard states in $appearance mode', (theme: ThemeDefinition) => {
  beforeEach(async () => {
    cleanup()
    await resetFocusBoardTestState()
    createThemeDocumentAdapter(document.documentElement).apply(theme)
  })

  function expectActiveTheme() {
    expect(document.documentElement.dataset.theme).toBe(theme.id)
    expect(document.documentElement.dataset.themeAppearance).toBe(theme.appearance)
  }

  it('renders the empty state', () => {
    renderBoard({ tasks: [], sessions: new Map(), attentionRows: [] })

    expectActiveTheme()
    const title = screen.getByText('All clear')
    expectTokenClass(title, 'text-[var(--of-text-secondary)]', '--of-text-secondary', theme.tokens.textSecondary)
  })

  it('renders the populated fallback while attention metadata is loading', async () => {
    renderBoard({
      tasks: [taskFocus, taskBacklog],
      sessions: new Map(),
      attentionRows: [],
      attentionRowsLoaded: false,
    })

    expectActiveTheme()
    await fireEvent.click(screen.getByRole('button', { name: /Backlog 1/i }))
    const backlogTitle = screen.getAllByText('Backlog task').find((element) => element.closest('[data-vim-item]'))
    expect(backlogTitle).toBeTruthy()
    expectTokenClass(backlogTitle!, 'text-[var(--of-text)]', '--of-text', theme.tokens.text)
  })

  it('renders the filtered state', async () => {
    renderBoard()

    await fireEvent.keyDown(window, { key: '/' })
    const filter = screen.getByRole('searchbox', { name: 'Filter tasks' })
    await fireEvent.input(filter, { target: { value: 'no matching task' } })
    await fireEvent.keyDown(filter, { key: 'Enter' })

    expectActiveTheme()
    const status = screen.getByText(/No tasks match/)
    expectTokenClass(status, 'text-[var(--of-text-secondary)]', '--of-text-secondary', theme.tokens.textSecondary)
  })

  it('renders the populated state', async () => {
    renderBoard({
      tasks: [taskBacklog],
      sessions: new Map(),
      attentionRows: [],
      attentionRowsLoaded: true,
    })

    await fireEvent.click(screen.getByRole('button', { name: /Backlog 1/i }))

    expectActiveTheme()
    const taskTitle = screen.getAllByText('Backlog task').find((element) => element.closest('[data-vim-item]'))
    expect(taskTitle).toBeTruthy()
    expectTokenClass(taskTitle!, 'text-[var(--of-text)]', '--of-text', theme.tokens.text)
    expect(screen.getByRole('button', { name: 'New task' })).toBeTruthy()
  })
})
