import { fireEvent, screen, within } from '@testing-library/svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import {
  makePr,
  makeSession,
  makeTask,
  renderBoard,
  resetFocusBoardTestState,
  taskBacklog,
  taskDoing,
  taskFocus,
} from './FocusBoard.test-utils'

describe('FocusBoard task presentation', () => {
  beforeEach(resetFocusBoardTestState)

  it('shows dependency wait hint on backlog rows only in the Backlog filter', async () => {
    const dependency = makeTask('T-5', 'doing', 'Dependency task')
    const waitingBacklog = { ...taskBacklog, depends_on: [dependency.id] }
    renderBoard({
      tasks: [taskFocus, waitingBacklog, dependency],
      sessions: new Map([[taskFocus.id, makeSession(taskFocus.id, 'paused', 'needs-review')]]),
    })

    expect(screen.queryByText('Waiting on 1 dep')).toBeNull()

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    const backlogCard = requireElement(document.querySelector('[data-vim-item]'), HTMLElement)
    expect(within(backlogCard).getByText('Waiting on 1 dep')).toBeTruthy()
  })

  it('uses completed dependency references for backlog wait hints without rendering completed tasks', async () => {
    const completedDependency = makeTask('T-done', 'done', 'Completed dependency')
    const waitingBacklog = { ...taskBacklog, depends_on: [completedDependency.id] }
    renderBoard({
      tasks: [waitingBacklog],
      dependencyReferenceTasks: [completedDependency],
      sessions: new Map(),
    })

    await fireEvent.click(await screen.findByRole('button', { name: /Backlog 1/i }))

    const backlogCard = requireElement(document.querySelector('[data-vim-item]'), HTMLElement)
    expect(within(backlogCard).queryByText('Waiting on 1 dep')).toBeNull()
    expect(within(backlogCard).queryByText('Completed dependency')).toBeNull()
  })

  it('renders Needs attention header when focus filter is active', async () => {
    renderBoard()
    expect(await screen.findByText('Needs attention')).toBeTruthy()
  })

  it('keeps running agents with unaddressed comments in the In Flight tab', async () => {
    renderBoard({
      tasks: [taskDoing],
      sessions: new Map([[taskDoing.id, makeSession(taskDoing.id, 'running', null)]]),
      prs: new Map([[taskDoing.id, [makePr(taskDoing.id, 2)]]]),
    })

    expect(await screen.findByRole('button', { name: /^Focus 0$/i })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: /In Flight 1/i }))
    expect(screen.getAllByText('Doing task').length).toBeGreaterThan(0)
  })

  it('computes focus count with unaddressed PR comments', async () => {
    renderBoard({
      tasks: [taskDoing],
      sessions: new Map(),
      prs: new Map([[taskDoing.id, [makePr(taskDoing.id, 2)]]]),
    })

    expect(await screen.findByRole('button', { name: /Focus 1/i })).toBeTruthy()
    expect(screen.getAllByText('Doing task').length).toBeGreaterThan(0)
  })

  it('surfaces merge conflicts in Needs attention cards', async () => {
    renderBoard({
      tasks: [taskDoing],
      sessions: new Map(),
      prs: new Map([[
        taskDoing.id,
        [{
          ...makePr(taskDoing.id, 0),
          mergeable_state: 'dirty',
        }],
      ]]),
    })

    expect(await screen.findByRole('button', { name: /Focus 1/i })).toBeTruthy()
    const boardCard = requireElement(document.querySelector('[data-vim-item]'), HTMLElement)
    expect(boardCard).toBeTruthy()
    expect(within(boardCard).getByText('Doing task')).toBeTruthy()
    expect(within(boardCard).getByText('Merge Conflict')).toBeTruthy()
    expect(within(boardCard).getByText('Pull request has merge conflicts that must be resolved.')).toBeTruthy()
  })
})
