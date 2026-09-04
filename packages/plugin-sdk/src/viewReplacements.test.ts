import { describe, expect, it, vi } from 'vitest'
import { validateOpenForgePackageMetadata } from './manifest'
import { createOpenForgeRegistryFake } from './testing'
import type { PluginTaskDetailReplacementProps } from './viewReplacements'

const Dashboard = vi.fn() as never
const TaskWorkspace = vi.fn() as never

function metadata(requires: string[] = ['viewReplacements']) {
  return {
    id: 'dashboard-plugin',
    apiVersion: 1 as const,
    displayName: 'Dashboard plugin',
    description: 'Provides a project dashboard.',
    frontend: './frontend.js',
    requires,
  }
}

describe('project dashboard replacement authoring contract', () => {
  it('accepts the viewReplacements package capability only for frontend plugins', () => {
    expect(validateOpenForgePackageMetadata(metadata())).toEqual([])
    expect(validateOpenForgePackageMetadata({ ...metadata(), frontend: undefined })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'requires', message: expect.stringMatching(/frontend/i) }),
      ]),
    )
  })

  it('registers a typed project dashboard replacement in the testing fake', () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'dashboard-plugin',
      projectId: 'project-1',
      packageMetadata: metadata(),
    })
    registry.frontendApi.viewReplacements.register({
      id: 'dashboard',
      target: 'project.dashboard',
      title: 'Planning',
      icon: 'panels-top-left',
      component: Dashboard,
    })

    const [replacement] = registry.snapshot.viewReplacements
    expect(replacement).toMatchObject({
      id: 'dashboard',
      qualifiedId: 'dashboard-plugin.dashboard',
      target: 'project.dashboard',
      title: 'Planning',
    })

    type DashboardProps = Parameters<NonNullable<typeof replacement>['component']>[0]
    const assertTypedProps = (_props: DashboardProps) => undefined
    expect(assertTypedProps).toBeTypeOf('function')
  })

  it('registers a typed task detail replacement with related data and host callbacks', () => {
    const registry = createOpenForgeRegistryFake({
      pluginId: 'dashboard-plugin',
      projectId: 'project-1',
      packageMetadata: metadata(),
    })
    registry.frontendApi.viewReplacements.register({
      id: 'task-workspace',
      target: 'task.detail',
      title: 'Task workspace',
      component: TaskWorkspace,
    })

    const replacement = registry.snapshot.viewReplacements.find(
      candidate => candidate.target === 'task.detail',
    )
    expect(replacement).toMatchObject({
      id: 'task-workspace',
      qualifiedId: 'dashboard-plugin.task-workspace',
      target: 'task.detail',
      title: 'Task workspace',
    })

    type TaskWorkspaceProps = Parameters<NonNullable<typeof replacement>['component']>[0]
    const assertTypedProps = (props: TaskWorkspaceProps & PluginTaskDetailReplacementProps) => {
      void props.api
      void props.context
      void props.project
      void props.task
      void props.relatedTasks
      void props.onOpenTask
      void props.onEditTask
      void props.onOpenTaskActions
      void props.onRefreshTask
    }
    expect(assertTypedProps).toBeTypeOf('function')
  })
})
