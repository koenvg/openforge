import { fireEvent, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bugLabel,
  getTaskInfoPanelTestDependencies,
  renderTaskInfoPanel,
  resetTaskInfoPanelTestState,
  taskWithLabels,
  uiLabel,
} from './TaskInfoPanel.testUtils'

const {
  addTaskLabel,
  getProjectTaskLabels,
  removeTaskLabel,
} = getTaskInfoPanelTestDependencies()

describe('TaskInfoPanel labels', () => {
  beforeEach(resetTaskInfoPanelTestState)

  it('renders existing labels and assigns/removes existing project labels through IPC', async () => {
    vi.mocked(getProjectTaskLabels).mockResolvedValue([bugLabel, uiLabel])
    renderTaskInfoPanel({ task: taskWithLabels([bugLabel]) })

    expect(screen.getByText('Labels')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove label bug' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Remove label bug' }))
    expect(removeTaskLabel).toHaveBeenCalledWith('T-42', bugLabel.id)

    await fireEvent.click(screen.getByRole('button', { name: 'Add label' }))
    const input = screen.getByRole('textbox', { name: 'Search labels' })
    await fireEvent.input(input, { target: { value: 'ui' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(addTaskLabel).toHaveBeenCalledWith('T-42', 'ui')
    })
  })

  it('creates and assigns a new label through IPC from unmatched task detail input', async () => {
    vi.mocked(getProjectTaskLabels).mockResolvedValue([bugLabel])
    vi.mocked(addTaskLabel).mockResolvedValue({ id: 3, projectId: 'proj-1', name: 'feature' })
    renderTaskInfoPanel({ task: taskWithLabels([]) })

    await fireEvent.click(screen.getByRole('button', { name: 'Add label' }))
    const input = screen.getByRole('textbox', { name: 'Search labels' })
    await fireEvent.input(input, { target: { value: 'feature' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(addTaskLabel).toHaveBeenCalledWith('T-42', 'feature')
    })
  })

  it('keeps project task label deletion controls out of task details', async () => {
    vi.mocked(getProjectTaskLabels).mockResolvedValue([bugLabel, uiLabel])
    renderTaskInfoPanel({ task: taskWithLabels([bugLabel]) })

    await fireEvent.click(screen.getByRole('button', { name: /^add label$/i }))

    expect(screen.queryByRole('button', { name: /delete project label/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete task label/i })).toBeNull()
  })

  it('resyncs rendered labels when the same task receives refreshed label data', async () => {
    const view = renderTaskInfoPanel({
      task: taskWithLabels([bugLabel]),
    })

    expect(screen.getByRole('button', { name: 'Remove label bug' })).toBeTruthy()

    await view.rerender({
      task: taskWithLabels([uiLabel]),
      workspacePath: null,
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove label ui' })).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Remove label bug' })).toBeNull()
  })
})
