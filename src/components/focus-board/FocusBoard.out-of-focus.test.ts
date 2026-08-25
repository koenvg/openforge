import { fireEvent, screen, waitFor } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { focusBoardFilters, outOfFocusTaskIdsByProject } from '../../lib/stores'
import {
  makeSession,
  renderBoard,
  resetFocusBoardTestState,
  taskDoing,
  taskDone,
  taskFocus,
} from './FocusBoard.test-utils'

describe('FocusBoard out-of-focus behavior', () => {
  beforeEach(resetFocusBoardTestState)

  it('sets aside tasks into Out of Focus and Return to Board restores normal placement', async () => {
    const ipc = await import('../../lib/ipc')
    const onProjectAttentionChanged = vi.fn(async () => undefined)
    renderBoard({ onProjectAttentionChanged })

    await fireEvent.click(await screen.findByRole('button', { name: /In Flight 1/i }))
    await fireEvent.contextMenu((await screen.findAllByText('Doing task'))[0])
    await fireEvent.click(screen.getByText('Set aside'))

    await waitFor(() => {
      expect(get(outOfFocusTaskIdsByProject).get('proj-1')).toEqual(new Set(['T-2']))
    })
    expect(ipc.setProjectConfig).toHaveBeenCalledWith('proj-1', 'low_fire_task_ids', JSON.stringify(['T-2']))
    await waitFor(() => {
      expect(onProjectAttentionChanged).toHaveBeenCalledOnce()
    })

    await fireEvent.click(screen.getByRole('button', { name: /Out of Focus 1/i }))
    expect(screen.getAllByText('Doing task').length).toBeGreaterThan(0)
    expect(screen.queryByText('Focus task')).toBeNull()

    await fireEvent.contextMenu(screen.getAllByText('Doing task')[0])
    await fireEvent.click(screen.getByText('Return to Board'))

    await waitFor(() => {
      expect(get(outOfFocusTaskIdsByProject).get('proj-1')).toBeUndefined()
    })
    await waitFor(() => {
      expect(onProjectAttentionChanged).toHaveBeenCalledTimes(2)
    })

    await fireEvent.click(screen.getByRole('button', { name: /In Flight 1/i }))
    expect(screen.getAllByText('Doing task').length).toBeGreaterThan(0)
  })

  it('shows empty state when no tasks match the Out of Focus filter', async () => {
    focusBoardFilters.set(new Map([['proj-1', 'out-of-focus']]))
    renderBoard({
      tasks: [taskDoing, taskDone],
      sessions: new Map([[taskDoing.id, makeSession(taskDoing.id, 'running', null)]]),
      prs: new Map(),
    })

    expect(await screen.findByText('Out of Focus is clear')).toBeTruthy()
  })

  it('does not flash focus tasks before the new project Out of Focus ids load', async () => {
    const ipc = await import('../../lib/ipc')
    const projectTwoTask = { ...taskFocus, id: 'T-project-2', project_id: 'proj-2', initial_prompt: 'Project 2 task' }
    let resolveProjectTwoOutOfFocus: ((value: string | null) => void) | undefined

    vi.mocked(ipc.getProjectConfig).mockImplementation(async (projectId: string, key: string) => {
      if (projectId === 'proj-2' && key === 'low_fire_task_ids') {
        return new Promise((resolve) => {
          resolveProjectTwoOutOfFocus = resolve
        })
      }
      return null
    })

    const firstView = renderBoard({ projectId: 'proj-1', tasks: [], sessions: new Map() })
    firstView.unmount()

    renderBoard({
      projectId: 'proj-2',
      tasks: [projectTwoTask],
      sessions: new Map([[projectTwoTask.id, makeSession(projectTwoTask.id, 'paused', 'needs-review')]]),
    })

    expect(screen.queryByText('Project 2 task')).toBeNull()

    resolveProjectTwoOutOfFocus?.(JSON.stringify([projectTwoTask.id]))
    await waitFor(() => {
      expect(get(outOfFocusTaskIdsByProject).get('proj-2')).toEqual(new Set([projectTwoTask.id]))
    })
    expect(screen.queryByText('Project 2 task')).toBeNull()
  })
})
