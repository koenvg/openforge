import type { StoryScenarioDefinition } from '../storyEnvironmentPreview'

export const taskBrowserTaskId = 'T-42'
export const taskBrowserProjectId = 'project-1'

export type TaskBrowserScenarioState =
  | 'populated'
  | 'empty'
  | 'loading'
  | 'failure'
  | 'disconnected'
  | 'retry'
  | 'feedback'
  | 'overflow'

const localPage = {
  eyebrow: 'OpenForge local preview',
  heading: 'Task implementation preview',
  body: 'Inspect the running change, exercise the primary path, and leave visual feedback without opening an external page.',
}

export function taskBrowserScenario(
  state: TaskBrowserScenarioState = 'populated',
  selectionComments: readonly string[] = ['Align the primary action'],
): StoryScenarioDefinition {
  const initialUrl = state === 'empty' ? undefined : 'https://catalog.openforge.local/tasks/T-42'
  return {
    plugin: {
      pluginId: 'com.openforge.task-browser',
      projectId: taskBrowserProjectId,
      taskId: taskBrowserTaskId,
      browserSurface: {
        initialUrl: initialUrl ?? null,
        title: 'Task implementation preview',
        page: state === 'overflow'
          ? {
              ...localPage,
              heading: 'A deliberately long implementation preview title that verifies constrained Task Browser layouts',
              body: `${localPage.body} ${'Long deterministic browser content stays inside the attached surface. '.repeat(8)}`,
            }
          : localPage,
        ...(state === 'loading' ? { state: { loading: true } } : {}),
        ...(state === 'failure' ? {
          state: {
            error: {
              code: 'LOAD_FAILED',
              message: 'The local preview could not be loaded',
              url: initialUrl!,
            },
          },
        } : {}),
        ...(state === 'disconnected' ? {
          connectionFailures: 100,
          connectionError: 'Browser runtime disconnected',
        } : {}),
        ...(state === 'retry' ? {
          connectionFailures: 1,
          connectionError: 'Browser runtime is restarting',
        } : {}),
        ...(state === 'feedback' ? { selectionComments } : {}),
      },
    },
  }
}
