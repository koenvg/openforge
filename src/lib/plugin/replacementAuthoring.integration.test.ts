import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginProjectDashboardReplacementProps } from '@openforge-app/plugin-sdk/frontend'
import example from '../../../packages/plugin-sdk/scripts/fixtures/view-replacements/frontend'
import { metadata } from '../../../packages/plugin-sdk/scripts/fixtures/view-replacements/metadata'
import { createTask } from '../../App.test-fixtures/tasks'
import { createRuntimeContributionRegistry } from './runtimeContributionRegistry'
import { applyRuntimeSnapshotContributions, clearPluginRuntimeContributions } from './pluginRuntimeContributions'
import { getRegisteredRenderableComponent, resolvePluginComponent } from './componentRegistry'
import { publishTaskInvalidation, subscribeToTaskInvalidations } from './pluginTaskInvalidations'

const project = { id: 'P-1', name: 'Example project', path: '/example', created_at: 1, updated_at: 1 }
const task = createTask({ id: 'T-1', projectId: project.id, title: 'Write documentation' })
const registries: ReturnType<typeof createRuntimeContributionRegistry>[] = []

async function activate() {
  const activeTasks = vi.fn(async (_projectId: string) => ({ tasks: [task], related: [] }))
  const taskDetail = vi.fn(async () => ({ task, related: [] }))
  const registry = createRuntimeContributionRegistry({
    pluginId: metadata.id,
    projectId: project.id,
    packageMetadata: metadata,
    host: {
      activeTasks,
      taskDetail,
      subscribeTaskChanges: (projectId, handler) => subscribeToTaskInvalidations(metadata.id, projectId, handler),
    },
  })
  registries.push(registry)
  await registry.activateFrontend(example)
  await applyRuntimeSnapshotContributions(metadata.id, registry.getSnapshot())
  return { registry, activeTasks, taskDetail }
}

async function component(id: string) {
  const source = getRegisteredRenderableComponent('viewReplacements', `${metadata.id}:${id}`)
  if (!source) throw new Error(`Missing example provider ${id}`)
  return resolvePluginComponent(source)
}

function publish(projectId = project.id) {
  publishTaskInvalidation({ projectId, taskId: task.id, reason: 'updated' })
}

afterEach(async () => {
  cleanup()
  for (const registry of registries.splice(0)) await registry.deactivate()
  clearPluginRuntimeContributions(metadata.id)
})

describe('public replacement authoring examples', () => {
  it('renders the dashboard through the runtime, refreshes only its project, and stops reads after unmount', async () => {
    const { registry, activeTasks } = await activate()
    const onOpenTask = vi.fn()
    const onComposeTask = vi.fn()
    const onOpenCommandSearch = vi.fn()
    const props: PluginProjectDashboardReplacementProps = {
      api: registry.getFrontendApi(), context: registry.getContextSnapshot(), project,
      onOpenTask, onComposeTask, onOpenCommandSearch,
    }
    const view = render(await component('dashboard'), { props })
    await fireEvent.click(await screen.findByRole('button', { name: task.title! }))
    expect(onOpenTask).toHaveBeenCalledWith(task.id)
    await fireEvent.click(screen.getByRole('button', { name: 'New task' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Search commands' }))
    expect(onComposeTask).toHaveBeenCalledOnce()
    expect(onOpenCommandSearch).toHaveBeenCalledOnce()
    expect(activeTasks).toHaveBeenCalledTimes(1)
    publish('P-other')
    expect(activeTasks).toHaveBeenCalledTimes(1)
    publish()
    await waitFor(() => expect(activeTasks).toHaveBeenCalledTimes(2))
    await view.unmount()
    publish()
    expect(activeTasks).toHaveBeenCalledTimes(2)
  })

  it('keeps the same project subscription, rebinds on project change, and ignores stale reads', async () => {
    const { registry, activeTasks } = await activate()
    const props = {
      api: registry.getFrontendApi(), context: registry.getContextSnapshot(), project,
      onOpenTask: vi.fn(), onComposeTask: vi.fn(), onOpenCommandSearch: vi.fn(),
    }
    let finishOldRead!: (result: { tasks: typeof task[]; related: [] }) => void
    activeTasks.mockImplementationOnce(() => new Promise(resolve => { finishOldRead = resolve }))
    const view = render(await component('dashboard'), { props })
    await waitFor(() => expect(activeTasks).toHaveBeenCalledOnce())
    await view.rerender({ ...props, project: { ...project, name: 'Renamed project' } })
    expect(activeTasks).toHaveBeenCalledOnce()
    activeTasks.mockResolvedValue({ tasks: [{ ...task, title: 'Current project task' }], related: [] })
    await view.rerender({ ...props, project: { ...project, id: 'P-2' } })
    expect(await screen.findByRole('button', { name: 'Current project task' })).toBeTruthy()
    finishOldRead({ tasks: [task], related: [] })
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(screen.queryByRole('button', { name: task.title! })).toBeNull()
    publish()
    expect(activeTasks).toHaveBeenCalledTimes(2)
    publish('P-2')
    await waitFor(() => expect(activeTasks).toHaveBeenCalledTimes(3))
    await view.unmount()
    await registry.deactivate()
    publish('P-2')
    expect(activeTasks).toHaveBeenCalledTimes(3)
    expect(registry.getSnapshot().viewReplacements).toEqual([])
  })

  it('shows dashboard read errors and allows a bounded retry', async () => {
    const { registry, activeTasks } = await activate()
    activeTasks.mockRejectedValueOnce(new Error('Tasks unavailable'))
    render(await component('dashboard'), { props: {
      api: registry.getFrontendApi(), context: registry.getContextSnapshot(), project,
      onOpenTask: vi.fn(), onComposeTask: vi.fn(), onOpenCommandSearch: vi.fn(),
    } })
    expect((await screen.findByRole('alert')).textContent).toContain('Tasks unavailable')
    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading tasks' }))
    expect(await screen.findByRole('button', { name: task.title! })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(activeTasks).toHaveBeenCalledTimes(2)
  })

  it('renders task props and host actions without a detail read, then cleans up invalidations on task change and unmount', async () => {
    const { registry, taskDetail } = await activate()
    const onRefreshTask = vi.fn()
    const onEditTask = vi.fn()
    const onOpenTaskActions = vi.fn()
    const onOpenTask = vi.fn()
    const props = {
      api: registry.getFrontendApi(), context: registry.createRenderContextSnapshot(project.id, task.id),
      project, task, relatedTasks: [{ ...task, id: 'T-2', title: 'Related task' }],
      onRefreshTask, onEditTask, onOpenTaskActions, onOpenTask,
    }
    const view = render(await component('task-detail'), { props })
    expect(await screen.findByText(task.prompt)).toBeTruthy()
    expect(taskDetail).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: 'Edit task' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Task actions' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Related task' }))
    expect(onEditTask).toHaveBeenCalledOnce()
    expect(onOpenTaskActions).toHaveBeenCalledOnce()
    expect(onOpenTask).toHaveBeenCalledWith('T-2', project.id)
    publishTaskInvalidation({ projectId: project.id, taskId: 'T-other', reason: 'updated' })
    publish('P-other')
    expect(onRefreshTask).not.toHaveBeenCalled()
    publish()
    expect(onRefreshTask).toHaveBeenCalledOnce()
    await view.rerender({ ...props, task: { ...task, id: 'T-2', prompt: 'Next task' } })
    publish()
    expect(onRefreshTask).toHaveBeenCalledOnce()
    publishTaskInvalidation({ projectId: project.id, taskId: null, reason: 'updated' })
    expect(onRefreshTask).toHaveBeenCalledTimes(2)
    await view.unmount()
    publishTaskInvalidation({ projectId: project.id, taskId: null, reason: 'updated' })
    expect(onRefreshTask).toHaveBeenCalledTimes(2)
  })
})
