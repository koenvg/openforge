import { fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLatestComponentProps } from '../../App.test-fixtures/component-props'
import { createTask } from '../../App.test-fixtures/tasks'
import type { TaskDetail } from '../../lib/types'
import {
  clearComponentRegistry,
  registerRenderableContributionComponent,
} from '../../lib/plugin/componentRegistry'
import {
  clearTaskDetailProviderIds,
  globalTaskDetailProviderId,
  globalTaskDetailProviderLoaded,
  projectTaskDetailProviderIds,
} from '../../lib/plugin/taskDetailProviders'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import TaskDetailPluginTestView from './TaskDetailPluginTestView.svelte'
import TaskDetailLifecyclePluginTestView from './TaskDetailLifecyclePluginTestView.svelte'
import PluginSlotCrashingView from '../plugin/PluginSlotCrashingView.svelte'
import TaskDetailProviderHost from './TaskDetailProviderHost.svelte'
import TaskDetailView from './TaskDetailView.svelte'

const terminalMocks = vi.hoisted(() => ({
  releaseAllForTask: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  clearProjectConfig: vi.fn(async () => undefined),
  getConfig: vi.fn(async () => null),
  getProjectConfig: vi.fn(async () => null),
  getTaskWorkspace: vi.fn(async () => null),
  setConfig: vi.fn(async () => undefined),
  setProjectConfig: vi.fn(async () => undefined),
  writePty: vi.fn(async () => undefined),
}))

vi.mock('../../lib/terminalSessionService', () => ({
  regularTerminalSessions: {
    getShellLifecycleState: vi.fn(() => undefined),
    getTaskTerminalTabsSession: vi.fn(() => undefined),
    releaseAllForTask: terminalMocks.releaseAllForTask,
  },
}))

vi.mock('./TaskDetailView.svelte', () => ({ default: vi.fn() }))

const task = createTask({ id: 'task-1', projectId: 'project-1' })
const project = {
  id: 'project-1',
  name: 'Project One',
  path: '/test/project-one',
  created_at: 1,
  updated_at: 1,
}
const relatedTask = {
  id: 'task-related',
  projectId: project.id,
  status: 'done' as const,
  title: 'Related task',
  dependsOn: [],
}


function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
function createProps(selectedTask: TaskDetail = task) {
  return {
    task: selectedTask,
    project,
    relatedTasks: [relatedTask],
    onRunAction: vi.fn(),
    onEdit: vi.fn(),
    onOpenTask: vi.fn(),
    onOpenTaskActions: vi.fn(),
    onRefreshTask: vi.fn(),
    onTaskUpdated: vi.fn(),
    onProjectAttentionChanged: vi.fn(),
    onRunAppRegistrationChange: vi.fn(),
  }
}

function selectPluginTaskDetail(component: unknown = TaskDetailPluginTestView): void {
  enabledPluginIds.set(new Set(['planning-plugin']))
  installedPlugins.set(new Map([['planning-plugin', {
    state: 'active',
    error: null,
    manifest: {},
  } as never]]))
  runtimeContributionSources.set(new Map([['planning-plugin', {
    pluginId: 'planning-plugin',
    viewReplacements: [{
      id: 'task-workspace',
      target: 'task.detail',
      title: 'Task workspace',
    }],
  }]]))
  registerRenderableContributionComponent(
    'viewReplacements',
    'planning-plugin:task-workspace',
    component as never,
  )
  projectTaskDetailProviderIds.set(new Map([[project.id, 'planning-plugin.task-workspace']]))
}


describe('TaskDetailProviderHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearComponentRegistry()
    clearTaskDetailProviderIds()
    globalTaskDetailProviderLoaded.set(true)
    enabledPluginIds.set(new Set())
    installedPlugins.set(new Map())
    runtimeContributionSources.set(new Map())
  })

  it('renders core task detail with host-owned task actions', () => {
    const hostProps = createProps()

    render(TaskDetailProviderHost, { props: hostProps })

    const props = getLatestComponentProps<{
      task: TaskDetail
      onRunAction: typeof hostProps.onRunAction
      onEdit: typeof hostProps.onEdit
      onOpenTask: typeof hostProps.onOpenTask
      hostLifecycle: { workspacePath: string | null; runApp: () => Promise<void> }
    }>(vi.mocked(TaskDetailView), 'task')

    expect(props.task).toEqual(task)
    expect(props.onRunAction).toBe(hostProps.onRunAction)
    expect(props.onEdit).toBe(hostProps.onEdit)
    expect(props.onOpenTask).toBe(hostProps.onOpenTask)
    expect(props.hostLifecycle.workspacePath).toBeNull()
    expect(props.hostLifecycle.runApp).toEqual(expect.any(Function))
  })

  it('replaces the core renderer when logical task identity changes', async () => {
    const rendered = render(TaskDetailProviderHost, { props: createProps() })

    expect(vi.mocked(TaskDetailView)).toHaveBeenCalledTimes(1)

    const nextTask = createTask({ id: 'task-2', projectId: 'project-1' })
    await rendered.rerender(createProps(nextTask))

    expect(vi.mocked(TaskDetailView)).toHaveBeenCalledTimes(2)
    const props = getLatestComponentProps<{ task: TaskDetail }>(vi.mocked(TaskDetailView), 'task')
    expect(props.task).toEqual(nextTask)
  })

  it('renders the selected plugin with task context, related tasks, and host callbacks', async () => {
    selectPluginTaskDetail()
    const props = createProps()
    render(TaskDetailProviderHost, { props })

    expect((await screen.findByTestId('plugin-task-detail')).textContent).toContain(
      'Project One:task-1:task-related:planning-plugin:project-1:task-1:api',
    )
    await fireEvent.click(screen.getByRole('button', { name: 'Open task' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Edit task' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Task actions' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh task' }))

    expect(props.onOpenTask).toHaveBeenCalledWith('task-2', project.id)
    expect(props.onEdit).toHaveBeenCalledWith(task.id)
    expect(props.onOpenTaskActions).toHaveBeenCalledOnce()
    expect(props.onRefreshTask).toHaveBeenCalledOnce()
    expect(vi.mocked(TaskDetailView)).not.toHaveBeenCalled()
    expect(get(projectTaskDetailProviderIds).get(project.id)).toBe('planning-plugin.task-workspace')
    expect(get(globalTaskDetailProviderId)).toBe('core')
  })


  it('ignores a plugin component load from the previous logical task', async () => {
    const firstLoad = deferred<unknown>()
    const secondLoad = deferred<unknown>()
    const componentLoader = vi.fn()
      .mockImplementationOnce(() => firstLoad.promise)
      .mockImplementationOnce(() => secondLoad.promise)
    selectPluginTaskDetail(componentLoader)
    const rendered = render(TaskDetailProviderHost, { props: createProps() })
    await vi.waitFor(() => expect(componentLoader).toHaveBeenCalledTimes(1))

    const nextTask = createTask({ id: 'task-2', projectId: project.id })
    await rendered.rerender(createProps(nextTask))
    await vi.waitFor(() => expect(componentLoader).toHaveBeenCalledTimes(2))

    firstLoad.resolve(TaskDetailPluginTestView)
    await vi.waitFor(() => expect(screen.queryByTestId('plugin-task-detail')).toBeNull())

    secondLoad.resolve(TaskDetailPluginTestView)
    expect((await screen.findByTestId('plugin-task-detail')).textContent).toContain('task-2')
  })
  it('uses core while an inherited provider is absent and restores it when enablement returns', async () => {
    globalTaskDetailProviderId.set('planning-plugin.task-workspace')
    projectTaskDetailProviderIds.set(new Map([[project.id, 'inherit']]))
    const props = createProps()
    render(TaskDetailProviderHost, { props })
    await vi.waitFor(() => expect(vi.mocked(TaskDetailView)).toHaveBeenCalled())

    installedPlugins.set(new Map([['planning-plugin', {
      state: 'active', error: null, manifest: {},
    } as never]]))
    registerRenderableContributionComponent(
      'viewReplacements',
      'planning-plugin:task-workspace',
      TaskDetailPluginTestView,
    )
    runtimeContributionSources.set(new Map([['planning-plugin', {
      pluginId: 'planning-plugin',
      viewReplacements: [{
        id: 'task-workspace', target: 'task.detail', title: 'Task workspace',
      }],
    }]]))
    enabledPluginIds.set(new Set(['planning-plugin']))
    expect(await screen.findByTestId('plugin-task-detail')).toBeTruthy()

    enabledPluginIds.set(new Set())
    await vi.waitFor(() => expect(screen.queryByTestId('plugin-task-detail')).toBeNull())
    enabledPluginIds.set(new Set(['planning-plugin']))
    registerRenderableContributionComponent(
      'viewReplacements',
      'planning-plugin:task-workspace',
      TaskDetailPluginTestView,
    )
    runtimeContributionSources.set(new Map([['planning-plugin', {
      pluginId: 'planning-plugin',
      viewReplacements: [{
        id: 'task-workspace', target: 'task.detail', title: 'Task workspace',
      }],
    }]]))
    installedPlugins.update(entries => {
      const next = new Map(entries)
      next.set('planning-plugin', { ...next.get('planning-plugin')!, state: 'active', error: null })
      return next
    })
    expect(await screen.findByTestId('plugin-task-detail')).toBeTruthy()
    expect(get(globalTaskDetailProviderId)).toBe('planning-plugin.task-workspace')
    expect(get(projectTaskDetailProviderIds).get(project.id)).toBe('inherit')
  })


  it.each([
    ['missing', null],
    ['loading failed', () => Promise.reject(new Error('task workspace load failed'))],
    ['rendering failed', PluginSlotCrashingView],
  ])('falls back locally to core task detail when the selected provider is %s', async (_case, component) => {
    if (component) selectPluginTaskDetail(component)
    else {
      enabledPluginIds.set(new Set(['planning-plugin']))
      installedPlugins.set(new Map([['planning-plugin', {
        state: 'active', error: null, manifest: {},
      } as never]]))
      runtimeContributionSources.set(new Map([['planning-plugin', {
        pluginId: 'planning-plugin',
        viewReplacements: [{
          id: 'task-workspace', target: 'task.detail', title: 'Task workspace',
        }],
      }]]))
      projectTaskDetailProviderIds.set(new Map([[project.id, 'planning-plugin.task-workspace']]))
    }

    const props = createProps()
    render(TaskDetailProviderHost, { props })
    await vi.waitFor(() => expect(vi.mocked(TaskDetailView)).toHaveBeenCalled())

    const coreProps = getLatestComponentProps<{ task: TaskDetail; onOpenTask: typeof props.onOpenTask }>(
      vi.mocked(TaskDetailView),
      'task',
    )
    expect(coreProps.task).toEqual(task)
    expect(coreProps.onOpenTask).toBe(props.onOpenTask)
    expect(get(installedPlugins).get('planning-plugin')?.state).toBe('active')
    expect(get(projectTaskDetailProviderIds).get(project.id)).toBe('planning-plugin.task-workspace')
  })


  it('retries a failed loader when the same provider is re-registered without changing its preference', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('temporary loader failure'))
      .mockResolvedValue(TaskDetailPluginTestView)
    selectPluginTaskDetail(loader)
    render(TaskDetailProviderHost, { props: createProps() })
    await vi.waitFor(() => expect(vi.mocked(TaskDetailView)).toHaveBeenCalled())
    expect(loader).toHaveBeenCalledTimes(1)

    registerRenderableContributionComponent('viewReplacements', 'planning-plugin:task-workspace', loader)

    expect(await screen.findByTestId('plugin-task-detail')).toBeTruthy()
    expect(loader).toHaveBeenCalledTimes(2)
    expect(get(projectTaskDetailProviderIds).get(project.id)).toBe('planning-plugin.task-workspace')
  })

  it('does not retry a failed provider when unrelated contributions or plugin metadata change', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('broken workspace'))
    selectPluginTaskDetail(loader)
    render(TaskDetailProviderHost, { props: createProps() })
    await vi.waitFor(() => expect(vi.mocked(TaskDetailView)).toHaveBeenCalled())

    runtimeContributionSources.update(sources => new Map(sources).set('other-plugin', {
      pluginId: 'other-plugin',
      commands: [{ id: 'refresh', title: 'Refresh' }],
    }))
    installedPlugins.update(plugins => new Map(plugins))
    await tick()

    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('tears down plugin renderers once for each logical task, project, provider, enablement, and route change', async () => {
    const mounted: string[] = []
    const destroyed: string[] = []
    const onMounted = (event: Event) => mounted.push((event as CustomEvent<string>).detail)
    const onDestroyed = (event: Event) => destroyed.push((event as CustomEvent<string>).detail)
    window.addEventListener('task-workspace-mounted', onMounted)
    window.addEventListener('task-workspace-destroyed', onDestroyed)

    try {
      selectPluginTaskDetail(TaskDetailLifecyclePluginTestView)
      projectTaskDetailProviderIds.set(new Map([
        [project.id, 'planning-plugin.task-workspace'],
        ['project-2', 'planning-plugin.task-workspace'],
      ]))
      const props = createProps()
      const rendered = render(TaskDetailProviderHost, { props })
      await vi.waitFor(() => expect(mounted).toEqual(['project-1:task-1']))
      expect(terminalMocks.releaseAllForTask).not.toHaveBeenCalled()

      const nextTask = createTask({ id: 'task-2', projectId: project.id })
      await rendered.rerender({ ...props, task: nextTask })
      await vi.waitFor(() => {
        expect(destroyed).toEqual(['project-1:task-1'])
        expect(mounted).toEqual(['project-1:task-1', 'project-1:task-2'])
      })
      expect(terminalMocks.releaseAllForTask).toHaveBeenCalledTimes(1)
      expect(terminalMocks.releaseAllForTask).toHaveBeenLastCalledWith('task-1')

      const nextProject = { ...project, id: 'project-2', name: 'Project Two' }
      const projectTask = createTask({ id: 'task-3', projectId: nextProject.id })
      await rendered.rerender({ ...props, project: nextProject, task: projectTask })
      await vi.waitFor(() => expect(destroyed.at(-1)).toBe('project-1:task-2'))
      expect(mounted.at(-1)).toBe('project-2:task-3')
      expect(terminalMocks.releaseAllForTask).toHaveBeenCalledTimes(2)
      expect(terminalMocks.releaseAllForTask).toHaveBeenLastCalledWith('task-2')

      projectTaskDetailProviderIds.set(new Map([[nextProject.id, 'core']]))
      await vi.waitFor(() => expect(destroyed.at(-1)).toBe('project-2:task-3'))
      expect(vi.mocked(TaskDetailView)).toHaveBeenCalledTimes(1)
      expect(terminalMocks.releaseAllForTask).toHaveBeenCalledTimes(2)

      projectTaskDetailProviderIds.set(new Map([[nextProject.id, 'planning-plugin.task-workspace']]))
      await vi.waitFor(() => expect(mounted.filter(id => id === 'project-2:task-3')).toHaveLength(2))
      expect(terminalMocks.releaseAllForTask).toHaveBeenCalledTimes(2)
      rendered.unmount()
      expect(destroyed.filter(id => id === 'project-2:task-3')).toHaveLength(2)
      expect(terminalMocks.releaseAllForTask).toHaveBeenCalledTimes(3)
      expect(terminalMocks.releaseAllForTask).toHaveBeenLastCalledWith('task-3')

      const enabledRender = render(TaskDetailProviderHost, {
        props: { ...props, project: nextProject, task: projectTask },
      })
      await vi.waitFor(() => expect(mounted.filter(id => id === 'project-2:task-3')).toHaveLength(3))
      enabledPluginIds.set(new Set())
      await vi.waitFor(() => expect(destroyed.filter(id => id === 'project-2:task-3')).toHaveLength(3))
      expect(terminalMocks.releaseAllForTask).toHaveBeenCalledTimes(3)
      enabledRender.unmount()
      expect(terminalMocks.releaseAllForTask).toHaveBeenCalledTimes(4)
      expect(terminalMocks.releaseAllForTask).toHaveBeenLastCalledWith('task-3')
    } finally {
      window.removeEventListener('task-workspace-mounted', onMounted)
      window.removeEventListener('task-workspace-destroyed', onDestroyed)
    }
  })
})
