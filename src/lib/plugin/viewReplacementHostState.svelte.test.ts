import type {
  PluginProjectDashboardReplacementProps,
  PluginTaskDetailReplacementProps,
} from '@openforge-app/plugin-sdk/frontend'
import type { Component } from 'svelte'
import { describe, expectTypeOf, it } from 'vitest'
import type { ViewReplacementHostState } from './viewReplacementHostState.svelte'
import { createViewReplacementHostState } from './viewReplacementHostState.svelte'

type TaskDetailState = ViewReplacementHostState<'task.detail'>
type ProjectDashboardState = ViewReplacementHostState<'project.dashboard'>
type TaskDetailTarget = Parameters<typeof createViewReplacementHostState<'task.detail'>>[0]['target']

function acceptTaskDetailTarget(_target: TaskDetailTarget): void {}

describe('view replacement host state contract', () => {
  it('derives component props from the replacement target', () => {
    expectTypeOf<TaskDetailState['resolvedComponent']>()
      .toEqualTypeOf<Component<PluginTaskDetailReplacementProps> | null>()
    expectTypeOf<ProjectDashboardState['resolvedComponent']>()
      .toEqualTypeOf<Component<PluginProjectDashboardReplacementProps> | null>()

    // @ts-expect-error A task-detail state cannot be configured for the dashboard target.
    acceptTaskDetailTarget('project.dashboard')
  })
})
