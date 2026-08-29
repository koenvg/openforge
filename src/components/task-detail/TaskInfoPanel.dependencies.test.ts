import { fireEvent, screen, within } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, TaskRelationshipReference } from '../../lib/types'
import {
  baseTask,
  getTaskInfoPanelTestDependencies,
  renderTaskInfoPanel,
  resetTaskInfoPanelTestState,
} from './TaskInfoPanel.testUtils'
import type { Task } from './TaskInfoPanel.testUtils'

const {
  dependencyReferenceTasks,
  projects,
  tasks,
} = getTaskInfoPanelTestDependencies()


function relationshipReference(task: Task): TaskRelationshipReference {
  return {
    id: task.id,
    status: task.status,
    project_id: task.project_id,
    title: task.title ?? task.initial_prompt,
    depends_on: task.depends_on,
  }
}
describe('TaskInfoPanel dependencies', () => {
  beforeEach(resetTaskInfoPanelTestState)

  it('does not render Dependencies section when task has no dependencies', () => {
    renderTaskInfoPanel()

    expect(screen.queryByText('// DEPENDS_ON')).toBeNull()
  })

  it('renders dependency chips with each dependency status and title from the task store', () => {
    const longDependencyTitle = 'Build a very long authentication middleware prerequisite that should remain readable via hover'
    const parentTask: Task = {
      ...baseTask,
      id: 'T-99',
      depends_on: ['T-41', 'T-17', 'T-03'],
    }
    tasks.set([
      { ...baseTask, id: 'T-41', status: 'done', initial_prompt: longDependencyTitle },
      { ...baseTask, id: 'T-17', status: 'doing', initial_prompt: 'Prepare database migrations' },
      { ...baseTask, id: 'T-03', status: 'backlog', initial_prompt: 'Document rollout plan' },
      parentTask,
    ])

    renderTaskInfoPanel({ task: parentTask })

    const dependenciesSection = screen.getByLabelText('Dependencies')
    expect(dependenciesSection.textContent).toContain('T-41')
    expect(dependenciesSection.textContent).toContain('done')
    expect(dependenciesSection.textContent).toContain(longDependencyTitle)
    expect(screen.getByText(longDependencyTitle).closest('[title]')?.getAttribute('title')).toBe(longDependencyTitle)
    expect(dependenciesSection.textContent).toContain('T-17')
    expect(dependenciesSection.textContent).toContain('doing')
    expect(dependenciesSection.textContent).toContain('Prepare database migrations')
    expect(dependenciesSection.textContent).toContain('T-03')
    expect(dependenciesSection.textContent).toContain('backlog')
    expect(dependenciesSection.textContent).toContain('Document rollout plan')
    expect(dependenciesSection.textContent).toContain('Waiting on 2 dependencies')
  })

  it('shows and opens cross-project dependencies and dependents', async () => {
    const selectedTask = { ...baseTask, depends_on: ['T-dependency'] }
    const crossProjectDependency = {
      ...baseTask,
      id: 'T-dependency',
      project_id: 'proj-2',
      initial_prompt: 'Prepare release tooling',
    }
    const crossProjectDependent = {
      ...baseTask,
      id: 'T-dependent',
      project_id: 'proj-2',
      initial_prompt: 'Ship the release',
      depends_on: [selectedTask.id],
    }
    const onOpenRelatedTask = vi.fn()
    projects.set([
      { id: 'proj-1', name: 'OpenForge', path: '/openforge' } as Project,
      { id: 'proj-2', name: 'Release Tools', path: '/release-tools' } as Project,
    ])
    tasks.set([selectedTask])
    dependencyReferenceTasks.set([
      relationshipReference(crossProjectDependency),
      relationshipReference(crossProjectDependent),
    ])

    renderTaskInfoPanel({ task: selectedTask, onOpenRelatedTask })

    const dependenciesSection = screen.getByLabelText('Dependencies')
    const dependentsSection = screen.getByLabelText('Dependent tasks')
    expect(within(dependenciesSection).getByText('Release Tools')).toBeTruthy()
    expect(within(dependentsSection).getByText('Release Tools')).toBeTruthy()

    await fireEvent.click(within(dependenciesSection).getByRole('button', { name: /T-dependency/ }))
    await fireEvent.click(within(dependentsSection).getByRole('button', { name: /T-dependent/ }))

    expect(onOpenRelatedTask).toHaveBeenNthCalledWith(1, 'T-dependency', 'proj-2')
    expect(onOpenRelatedTask).toHaveBeenNthCalledWith(2, 'T-dependent', 'proj-2')
  })

  it('resolves completed dependencies from dependency-only reference tasks', () => {
    const completedDependencyTitle = 'Completed setup task'
    const parentTask: Task = {
      ...baseTask,
      id: 'T-99',
      depends_on: ['T-done'],
    }
    tasks.set([parentTask])
    dependencyReferenceTasks.set([
      relationshipReference({ ...baseTask, id: 'T-done', status: 'done', initial_prompt: completedDependencyTitle }),
    ])

    renderTaskInfoPanel({ task: parentTask })

    const dependenciesSection = screen.getByLabelText('Dependencies')
    expect(dependenciesSection.textContent).toContain('T-done')
    expect(dependenciesSection.textContent).toContain('done')
    expect(dependenciesSection.textContent).toContain(completedDependencyTitle)
    expect(screen.getByText('All dependencies done')).toBeTruthy()
  })

  it('shows dependency readiness when every dependency is done', () => {
    const parentTask: Task = {
      ...baseTask,
      id: 'T-99',
      depends_on: ['T-41', 'T-17'],
    }
    tasks.set([
      { ...baseTask, id: 'T-41', status: 'done' },
      { ...baseTask, id: 'T-17', status: 'done' },
      parentTask,
    ])

    renderTaskInfoPanel({ task: parentTask })

    expect(screen.getByText('All dependencies done')).toBeTruthy()
  })

  it('renders missing dependency tasks as unknown and still waiting', () => {
    const parentTask: Task = {
      ...baseTask,
      id: 'T-99',
      depends_on: ['T-missing'],
    }
    tasks.set([parentTask])

    renderTaskInfoPanel({ task: parentTask })

    const dependenciesSection = screen.getByLabelText('Dependencies')
    expect(dependenciesSection.textContent).toContain('T-missing')
    expect(dependenciesSection.textContent).toContain('unknown')
    expect(dependenciesSection.textContent).toContain('Waiting on 1 dependency')
  })

  it('uses dependency references when computing dependent readiness', () => {
    const selectedTask = { ...baseTask, id: 'T-42' }
    const completedHiddenPrerequisite = {
      ...baseTask,
      id: 'T-7',
      status: 'done' as const,
      initial_prompt: 'Hidden completed prerequisite',
    }
    const readyDependent = {
      ...baseTask,
      id: 'T-50',
      initial_prompt: 'Start rollout after auth middleware',
      depends_on: ['T-42', 'T-7'],
    }
    tasks.set([selectedTask, readyDependent])
    dependencyReferenceTasks.set([relationshipReference(completedHiddenPrerequisite)])

    renderTaskInfoPanel({ task: selectedTask, onOpenRelatedTask: vi.fn() })

    const dependentsSection = screen.getByLabelText('Dependent tasks')
    expect(dependentsSection.textContent).toContain('T-50')
    expect(dependentsSection.textContent).toContain('ready after this')
    expect(dependentsSection.textContent).not.toContain('still waits on 1 dependency')
  })

  it('renders tasks that depend on the selected task and highlights what is ready after this', () => {
    const selectedTask = { ...baseTask, id: 'T-42' }
    const donePrerequisite = {
      ...baseTask,
      id: 'T-7',
      status: 'done' as const,
      initial_prompt: 'Already completed prerequisite',
    }
    const waitingPrerequisite = {
      ...baseTask,
      id: 'T-8',
      status: 'doing' as const,
      initial_prompt: 'Still in progress prerequisite',
    }
    const readyDependent = {
      ...baseTask,
      id: 'T-50',
      initial_prompt: 'Start rollout after auth middleware',
      depends_on: ['T-42', 'T-7'],
    }
    const stillBlockedDependent = {
      ...baseTask,
      id: 'T-51',
      initial_prompt: 'Deploy after remaining prerequisites',
      depends_on: ['T-42', 'T-8'],
    }
    tasks.set([selectedTask, readyDependent, stillBlockedDependent, donePrerequisite, waitingPrerequisite])

    renderTaskInfoPanel({ task: selectedTask })

    const dependentsSection = screen.getByLabelText('Dependent tasks')
    expect(dependentsSection.textContent).toContain('T-50')
    expect(dependentsSection.textContent).toContain('Start rollout after auth middleware')
    expect(dependentsSection.textContent).toContain('ready after this')
    expect(dependentsSection.textContent).toContain('T-51')
    expect(dependentsSection.textContent).toContain('Deploy after remaining prerequisites')
    expect(dependentsSection.textContent).toContain('still waits on 1 dependency')
  })
})
