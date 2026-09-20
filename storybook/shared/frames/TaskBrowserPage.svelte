<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import TaskBrowserTab from '../../../plugins/task-browser/src/TaskBrowserTab.svelte'
  import { taskBrowserProjectId, taskBrowserTaskId } from '../fixtures/taskBrowserScenario'
  import PageFrame from './PageFrame.svelte'
  import TaskPaneFrame from './TaskPaneFrame.svelte'

  let { api, context, taskId = taskBrowserTaskId }: {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    taskId?: string
  } = $props()

  const tab = {
    pluginId: 'com.openforge.task-browser',
    contributionId: 'browser',
    namespacedId: 'com.openforge.task-browser:browser',
    title: 'Browser',
    icon: 'globe',
    order: 20,
    requiresWorkspace: false,
  }
</script>

<PageFrame currentView="board">
  <TaskPaneFrame {tab} {taskId}>
    <TaskBrowserTab {api} {context} {taskId} projectId={taskBrowserProjectId} />
  </TaskPaneFrame>
</PageFrame>
