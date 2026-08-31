import { fireEvent, screen, within } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, TaskDetail, TaskReference } from '../../lib/types'
import type { Writable } from 'svelte/store'
import {
  baseTask,
  getTaskInfoPanelTestDependencies,
  renderTaskInfoPanel,
  resetTaskInfoPanelTestState,
} from './TaskInfoPanel.testUtils'

const {
  dependencyReferenceTasks,
  projects,
  tasks,
} = getTaskInfoPanelTestDependencies()
const writableTasks = tasks as Writable<TaskDetail[]>
const writableDependencyReferences = dependencyReferenceTasks as Writable<TaskReference[]>


function relationshipReference(task: TaskDetail): TaskReference {
  return {
    id: task.id,
    status: task.status,
    projectId: task.projectId,
    title: task.title ?? task.prompt,
    dependsOn: task.dependsOn,
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
    const parentTask: TaskDetail = {
      ...baseTask,
      id: 'T-99',
      dependsOn: ['T-41', 'T-17', 'T-03'],
    }
    writableTasks.set([
      { ...baseTask, id: 'T-41', status: 'done', prompt: longDependencyTitle, title: longDependencyTitle },
      { ...baseTask, id: 'T-17', status: 'doing', prompt: 'Prepare database migrations', title: 'Prepare database migrations' },
      { ...baseTask, id: 'T-03', status: 'backlog', prompt: 'Document rollout plan', title: 'Document rollout plan' },
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
    const selectedTask = { ...baseTask, dependsOn: ['T-dependency'] }
    const crossProjectDependency = {
      ...baseTask,
      id: 'T-dependency',
      projectId: 'proj-2',
      prompt: 'Prepare release tooling',
      title: 'Prepare release tooling',
    }
    const crossProjectDependent = {
      ...baseTask,
      id: 'T-dependent',
      projectId: 'proj-2',
      prompt: 'Ship the release',
      title: 'Ship the release',
      dependsOn: [selectedTask.id],
    }
    const onOpenRelatedTask = vi.fn()
    projects.set([
      { id: 'proj-1', name: 'OpenForge', path: '/openforge' } as Project,
      { id: 'proj-2', name: 'Release Tools', path: '/release-tools' } as Project,
    ])
    writableTasks.set([selectedTask])
    writableDependencyReferences.set([
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
    const parentTask: TaskDetail = {
      ...baseTask,
      id: 'T-99',
      dependsOn: ['T-done'],
    }
    writableTasks.set([parentTask])
    writableDependencyReferences.set([
      relationshipReference({ ...baseTask, id: 'T-done', status: 'done', prompt: completedDependencyTitle, title: completedDependencyTitle }),
    ])

    renderTaskInfoPanel({ task: parentTask })

    const dependenciesSection = screen.getByLabelText('Dependencies')
    expect(dependenciesSection.textContent).toContain('T-done')
    expect(dependenciesSection.textContent).toContain('done')
    expect(dependenciesSection.textContent).toContain(completedDependencyTitle)
    expect(screen.getByText('All dependencies done')).toBeTruthy()
  })

  it('shows dependency readiness when every dependency is done', () => {
    const parentTask: TaskDetail = {
      ...baseTask,
      id: 'T-99',
      dependsOn: ['T-41', 'T-17'],
    }
    writableTasks.set([
      { ...baseTask, id: 'T-41', status: 'done' },
      { ...baseTask, id: 'T-17', status: 'done' },
      parentTask,
    ])

    renderTaskInfoPanel({ task: parentTask })

    expect(screen.getByText('All dependencies done')).toBeTruthy()
  })

  it('renders missing dependency tasks as unknown and still waiting', () => {
    const parentTask: TaskDetail = {
      ...baseTask,
      id: 'T-99',
      dependsOn: ['T-missing'],
    }
    writableTasks.set([parentTask])

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
      prompt: 'Hidden completed prerequisite',
      title: 'Hidden completed prerequisite',
    }
    const readyDependent = {
      ...baseTask,
      id: 'T-50',
      prompt: 'Start rollout after auth middleware',
      title: 'Start rollout after auth middleware',
      dependsOn: ['T-42', 'T-7'],
    }
    writableTasks.set([selectedTask, readyDependent])
    writableDependencyReferences.set([relationshipReference(completedHiddenPrerequisite)])

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
      prompt: 'Already completed prerequisite',
      title: 'Already completed prerequisite',
    }
    const waitingPrerequisite = {
      ...baseTask,
      id: 'T-8',
      status: 'doing' as const,
      prompt: 'Still in progress prerequisite',
      title: 'Still in progress prerequisite',
    }
    const readyDependent = {
      ...baseTask,
      id: 'T-50',
      prompt: 'Start rollout after auth middleware',
      title: 'Start rollout after auth middleware',
      dependsOn: ['T-42', 'T-7'],
    }
    const stillBlockedDependent = {
      ...baseTask,
      id: 'T-51',
      prompt: 'Deploy after remaining prerequisites',
      title: 'Deploy after remaining prerequisites',
      dependsOn: ['T-42', 'T-8'],
    }
    writableTasks.set([selectedTask, readyDependent, stillBlockedDependent, donePrerequisite, waitingPrerequisite])

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
