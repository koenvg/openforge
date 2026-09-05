import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import type { TaskDependencySummary, TaskDependentSummary } from '../../../lib/taskDependencies'
import TaskRelationshipDetailSection from './TaskRelationshipDetailSection.svelte'

describe('TaskRelationshipDetailSection', () => {
  it('renders full dependency summaries with titles and long-form waiting text', () => {
    const dependencies: TaskDependencySummary[] = [
      {
        id: 'T-1',
        status: 'done',
        title: 'Finish schema changes',
        displayTitle: 'Finish schema changes',
        tooltipTitle: 'Finish schema changes',
        projectId: 'P-1',
        projectName: 'Release Tools',
      },
      {
        id: 'T-missing',
        status: null,
        title: 'T-missing',
        displayTitle: null,
        tooltipTitle: 'T-missing',
        projectId: null,
        projectName: null,
      },
    ]

    render(TaskRelationshipDetailSection, {
      props: {
        kind: 'dependencies',
        items: dependencies,
        waitingDependencyCount: 1,
        density: 'full',
      },
    })

    const section = screen.getByLabelText('Dependencies')
    expect(section.textContent).toContain('Dependencies')
    expect(section.textContent).not.toContain('// DEPENDS_ON')
    expect(section.textContent).toContain('T-1')
    expect(section.textContent).toContain('done')
    expect(section.textContent).toContain('Finish schema changes')
    expect(screen.getByText('Finish schema changes').closest('[title]')?.getAttribute('title')).toBe('Finish schema changes')
    expect(section.textContent).toContain('Release Tools')
    expect(section.textContent).not.toContain('Other project:')
    expect(section.textContent).toContain('T-missing')
    expect(section.textContent).toContain('unknown')
    expect(screen.getByText('done').closest('[data-variant]')?.getAttribute('data-variant')).toBe('status-success')
    expect(screen.getByText('unknown').closest('[data-variant]')?.getAttribute('data-variant')).toBe('status-neutral')
    expect(section.textContent).toContain('Waiting on 1 dependency')
  })

  const dependentSummaries: TaskDependentSummary[] = [
    {
      id: 'T-2',
      status: 'backlog',
      title: 'Begin rollout',
      displayTitle: 'Begin rollout',
      tooltipTitle: 'Begin rollout',
      projectId: 'P-2',
      projectName: 'Release Tools',
      remainingDependencyCountAfterCurrentDone: 0,
    },
    {
      id: 'T-3',
      status: 'backlog',
      title: 'Deploy after second prerequisite',
      displayTitle: 'Deploy after second prerequisite',
      tooltipTitle: 'Deploy after second prerequisite',
      projectId: 'P-1',
      projectName: null,
      remainingDependencyCountAfterCurrentDone: 1,
    },
  ]

  it('renders compact dependent summaries with short readiness labels', () => {
    render(TaskRelationshipDetailSection, {
      props: {
        kind: 'dependents',
        items: dependentSummaries,
        density: 'compact',
      },
    })

    const section = screen.getByLabelText('Dependent tasks')
    expect(section.textContent).toContain('Dependent tasks')
    expect(section.textContent).not.toContain('// DEPENDENTS')
    expect(section.textContent).toContain('T-2')
    expect(section.textContent).not.toContain('Other:')
    expect(section.querySelector('[title^="Other project:"]')).toBeNull()
    expect(section.textContent).toContain('ready after this')
    expect(section.textContent).toContain('T-3')
    expect(section.textContent).toContain('still waits on 1 dep')
    expect(section.textContent).toContain('2 tasks depend on this one')
    expect(section.textContent).not.toContain('Begin rollout')
    expect(section.querySelector('[title="Begin rollout"]')).toBeTruthy()
  })

  it('calls the related task navigation callback when a relationship is clicked', async () => {
    const onOpenRelatedTask = vi.fn()

    render(TaskRelationshipDetailSection, {
      props: {
        kind: 'dependents',
        items: dependentSummaries,
        density: 'full',
        onOpenRelatedTask,
      },
    })

    expect(screen.getByLabelText('Dependent tasks').textContent).not.toContain('Other project:')

    const relationshipButton = screen.getByRole('button', { name: /T-2/ })
    expect(relationshipButton.getAttribute('data-control-kind')).toBe('text')
    expect(relationshipButton.style.getPropertyValue('--of-border-interactive')).toBe('var(--of-status-neutral)')
    await fireEvent.click(relationshipButton)

    expect(onOpenRelatedTask).toHaveBeenCalledWith('T-2', 'P-2')
    expect(onOpenRelatedTask).toHaveBeenCalledTimes(1)
  })
})
