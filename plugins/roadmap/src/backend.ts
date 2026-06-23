import { defineBackendPlugin } from '@openforge/plugin-sdk/backend'
import type { BackendOpenForgeAPI } from '@openforge/plugin-sdk/backend'
import type {
  CreateIssueRequest,
  EditIssueRequest,
  RoadmapBoard,
  RoadmapConfig,
  SetColumnLabelsRequest,
  SetValueRequest,
} from './lib/types'

// The plugin host maps camelCase qualified command ids to the core app-invoke
// snake_case commands (see plugin_host/callbacks.rs). Mirrors github-sync's
// host-command pattern; the literal "openforge" prefix is assembled to avoid a
// bundler rewriting it.
const HOST_COMMAND_NAMESPACE = ['open', 'forge'].join('')

function hostCommandId(command: string): string {
  return `${HOST_COMMAND_NAMESPACE}.${command}`
}

function invokeHostCommand<TOutput>(
  openforge: BackendOpenForgeAPI,
  command: string,
  payload?: unknown,
): Promise<TOutput> {
  return openforge.commands.invokeGlobal<TOutput>(hostCommandId(command), payload ?? null)
}

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(
      openforge.backend.registerMethod<{ projectId: string }, RoadmapBoard>('roadmap_get_board', {
        handler: (request) => invokeHostCommand<RoadmapBoard>(openforge, 'roadmapGetBoard', request),
      }),
    )

    context.subscriptions.add(
      openforge.backend.registerMethod<SetValueRequest, null>('roadmap_set_value', {
        handler: (request) => invokeHostCommand<null>(openforge, 'roadmapSetValue', request),
      }),
    )

    context.subscriptions.add(
      openforge.backend.registerMethod<{ projectId: string }, RoadmapConfig>('roadmap_get_config', {
        handler: (request) => invokeHostCommand<RoadmapConfig>(openforge, 'roadmapGetConfig', request),
      }),
    )

    context.subscriptions.add(
      openforge.backend.registerMethod<SetColumnLabelsRequest, null>('roadmap_set_column_labels', {
        handler: (request) => invokeHostCommand<null>(openforge, 'roadmapSetColumnLabels', request),
      }),
    )

    context.subscriptions.add(
      openforge.backend.registerMethod<CreateIssueRequest, { issue: RoadmapIssueResult }>('roadmap_create_issue', {
        handler: (request) =>
          invokeHostCommand<{ issue: RoadmapIssueResult }>(openforge, 'roadmapCreateIssue', request),
      }),
    )

    context.subscriptions.add(
      openforge.backend.registerMethod<EditIssueRequest, null>('roadmap_edit_issue', {
        handler: (request) => invokeHostCommand<null>(openforge, 'roadmapEditIssue', request),
      }),
    )
  },
})

// The shape of a created issue returned by roadmap_create_issue. Kept local
// because only the backend proxy references it as a return type here.
interface RoadmapIssueResult {
  number: number
  title: string
  body: string | null
  labels: { name: string; color: string }[]
}
