import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultProps, resetSettingsViewTest } from './SettingsView.testUtils'
import { createAction, loadActions, saveActions } from '../../lib/actions'
import SettingsView from './SettingsView.svelte'

describe('SettingsView action management', () => {
  beforeEach(resetSettingsViewTest)

  it('renders Add Action button', () => {
    render(SettingsView, { props: defaultProps })
    expect(screen.getByRole('button', { name: /add action/i })).toBeTruthy()
  })

  it('clicking Add Action creates a new action entry', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])
    vi.mocked(createAction).mockReturnValue({
      id: 'new-action-id',
      name: 'New Action',
      prompt: '',
      builtin: false,
      enabled: true,
    })

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const addButton = screen.getByRole('button', { name: /add action/i })
    await fireEvent.click(addButton)

    await vi.waitFor(() => {
      expect(screen.getByDisplayValue('New Action')).toBeTruthy()
    })
  })

  it('renders action toggle checkboxes', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThan(0)
  })
  it('reset to defaults shows only one confirm dialog', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const resetButton = screen.getByRole('button', { name: /reset to defaults/i })
    await fireEvent.click(resetButton)

    expect(confirmSpy).toHaveBeenCalledTimes(1)

    confirmSpy.mockRestore()
  })

  it('deleting a builtin action shows only one confirm dialog', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    const deleteButton = screen.getByTitle('Delete action')
    await fireEvent.click(deleteButton)

    expect(confirmSpy).toHaveBeenCalledTimes(1)

    confirmSpy.mockRestore()
  })

  it('reset to defaults auto-saves actions', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'custom-1', name: 'Custom', prompt: 'test', builtin: false, enabled: true },
    ])
    vi.mocked(saveActions).mockResolvedValue(undefined)

    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByDisplayValue('Custom')).toBeTruthy()
    })

    const resetButton = screen.getByRole('button', { name: /reset to defaults/i })
    await fireEvent.click(resetButton)

    await vi.waitFor(() => {
      expect(saveActions).toHaveBeenCalledWith('test-project-id', expect.any(Array))
    })

    window.confirm = globalThis.confirm
  })

  it('deleting a builtin action auto-saves actions', async () => {
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'builtin-go', name: 'Go', prompt: '', builtin: true, enabled: true },
    ])
    vi.mocked(saveActions).mockResolvedValue(undefined)

    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(SettingsView, { props: defaultProps })

    await vi.waitFor(() => {
      expect(screen.getByText('Go')).toBeTruthy()
    })

    vi.mocked(saveActions).mockClear()

    const deleteButton = screen.getByTitle('Delete action')
    await fireEvent.click(deleteButton)

    await vi.waitFor(() => {
      expect(saveActions).toHaveBeenCalledWith('test-project-id', [])
    })

    window.confirm = globalThis.confirm
  })
})
