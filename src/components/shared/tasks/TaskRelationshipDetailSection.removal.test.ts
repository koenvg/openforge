import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCollapsedSections } from '@openforge-app/plugin-sdk/collapsibleSectionState'
import type { TaskDependencySummary } from '../../../lib/taskDependencies'
import TaskRelationshipDetailSection from './TaskRelationshipDetailSection.svelte'

const items: TaskDependencySummary[] = ['T-2', 'T-3'].map(id => ({
  id, status: 'backlog', title: `Prerequisite ${id}`, displayTitle: `Prerequisite ${id}`,
  tooltipTitle: `Prerequisite ${id}`, projectId: 'P-1', projectName: 'Project',
}))
const removeButton = (id: string) => screen.getByRole('button', { name: `Remove dependency ${id}` })
const confirmButton = (id: string) => screen.getByRole('button', { name: new RegExp(`Confirm removing ${id} from T-1`) })
const cancelButton = (id: string) => screen.getByRole('button', { name: `Cancel removing dependency ${id}` })

function setup() {
  const onRemoveDependency = vi.fn()
  const onOpenRelatedTask = vi.fn()
  const view = render(TaskRelationshipDetailSection, {
    kind: 'dependencies', taskId: 'T-1', items, onRemoveDependency, onOpenRelatedTask,
  })
  return { ...view, onRemoveDependency, onOpenRelatedTask }
}

beforeEach(clearCollapsedSections)
afterEach(cleanup)

describe('inline dependency removal', () => {
  it('requires manage mode and a separate icon-only confirmation, while navigation stays separate', async () => {
    const { container, onRemoveDependency, onOpenRelatedTask } = setup()
    expect(screen.queryByRole('button', { name: 'Remove dependency T-2' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: /T-2.*Prerequisite/ }))
    expect(onOpenRelatedTask).toHaveBeenCalledExactlyOnceWith('T-2', 'P-1')
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    expect(removeButton('T-2').textContent).toBe('')
    await fireEvent.click(removeButton('T-2'))
    expect(onRemoveDependency).not.toHaveBeenCalled()
    expect(confirmButton('T-2').textContent).toBe('')
    expect(cancelButton('T-2').textContent).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.querySelector('button button')).toBeNull()
    await fireEvent.click(confirmButton('T-2'))
    expect(onRemoveDependency).toHaveBeenCalledExactlyOnceWith('T-2')
    expect(onOpenRelatedTask).toHaveBeenCalledTimes(1)
  })

  it('arms only one chip and cancels without writing', async () => {
    const { onRemoveDependency } = setup()
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    await fireEvent.click(removeButton('T-2'))
    await fireEvent.click(removeButton('T-3'))
    expect(screen.queryByRole('button', { name: /Confirm removing T-2/ })).toBeNull()
    await fireEvent.click(cancelButton('T-3'))
    expect(removeButton('T-3')).toBeTruthy()
    expect(onRemoveDependency).not.toHaveBeenCalled()
  })

  it('focuses cancel, ignores repeated input, and lets Escape cancel without navigation', async () => {
    const { onRemoveDependency, onOpenRelatedTask } = setup()
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    await fireEvent.click(removeButton('T-2'))
    expect(document.activeElement).toBe(cancelButton('T-2'))
    await fireEvent.click(confirmButton('T-2'), { detail: 2 })
    expect(onRemoveDependency).not.toHaveBeenCalled()
    const confirm = confirmButton('T-2')
    confirm.focus()
    const allowed = await fireEvent.keyDown(confirm, { key: 'Enter', repeat: true })
    expect(allowed).toBe(false)
    await fireEvent.keyDown(cancelButton('T-2'), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /Confirm removing/ })).toBeNull()
    expect(onRemoveDependency).not.toHaveBeenCalled()
    expect(onOpenRelatedTask).not.toHaveBeenCalled()
  })

  it('resets on task changes and collapse, and drops a disappearing candidate', async () => {
    const { rerender, onRemoveDependency } = setup()
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    await fireEvent.click(removeButton('T-2'))
    await rerender({ taskId: 'T-4' })
    expect(screen.getByRole('button', { name: 'Manage dependencies' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Confirm removing/ })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    await fireEvent.click(removeButton('T-2'))
    await fireEvent.click(screen.getByRole('button', { name: 'Dependencies' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Dependencies' }))
    expect(screen.getByRole('button', { name: 'Manage dependencies' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    await fireEvent.click(removeButton('T-2'))
    await rerender({ items: [items[1]] })
    await rerender({ items })
    expect(screen.queryByRole('button', { name: /Confirm removing/ })).toBeNull()
    expect(onRemoveDependency).not.toHaveBeenCalled()
  })

  it('discards confirmation when management ends or the view is destroyed', async () => {
    const { unmount, onRemoveDependency } = setup()
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    await fireEvent.click(removeButton('T-2'))
    await fireEvent.click(screen.getByRole('button', { name: 'Done managing dependencies' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    expect(screen.queryByRole('button', { name: /Confirm removing/ })).toBeNull()
    await fireEvent.click(removeButton('T-2'))
    unmount()
    setup()
    expect(screen.getByRole('button', { name: 'Manage dependencies' })).toBeTruthy()
    expect(onRemoveDependency).not.toHaveBeenCalled()
  })

  it('does not offer removal on dependent tasks', () => {
    render(TaskRelationshipDetailSection, {
      kind: 'dependents', taskId: 'T-1', items, onRemoveDependency: vi.fn(),
    })
    expect(within(screen.getByLabelText('Dependent tasks')).queryByRole('button', { name: 'Manage dependencies' })).toBeNull()
  })
})
