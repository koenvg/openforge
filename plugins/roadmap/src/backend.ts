import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import {
  describeAnthropicError,
  MissingApiKeyError,
  refineTicket,
  reviseTicket,
} from './lib/anthropic/client'
import { loadRepoContext } from './lib/anthropic/context'
import { readApiKey } from './lib/settings/apiKey'
import type {
  CreateIssueRequest,
  EditIssueRequest,
  RoadmapBoard,
  RoadmapConfig,
  RefineTicketRequest,
  SetColumnLabelsRequest,
  SetValueRequest,
  TicketDraft,
  UpdateLabelColorRequest,
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

    context.subscriptions.add(
      openforge.backend.registerMethod<UpdateLabelColorRequest, null>('roadmap_update_label_color', {
        handler: (request) => invokeHostCommand<null>(openforge, 'roadmapUpdateLabelColor', request),
      }),
    )

    // The only method here that doesn't proxy to core. Refine used to reach
    // openforge.roadmapRefineTicket, which spawns an agent CLI headless — ~15s before
    // the dialog saw anything. Calling the API from here is the same work without the
    // process spawn. The key comes from plugin storage, so a user without one gets a
    // gated button (see CreateDialog) rather than a failure at call time.
    context.subscriptions.add(
      openforge.backend.registerMethod<RefineTicketRequest, TicketDraft>('roadmap_refine_ticket', {
        handler: (request) => refineHandler(openforge, request),
      }),
    )
  },
})

async function refineHandler(
  openforge: BackendOpenForgeAPI,
  request: RefineTicketRequest,
): Promise<TicketDraft> {
  const key = await readApiKey(openforge.storage)
  if (!key) throw new MissingApiKeyError()

  try {
    const context = await loadRepoContext(openforge, {
      projectId: request.projectId,
      repo: request.repo,
      repoLabels: request.repoLabels,
    })

    const draft = request.draft
    return draft
      ? await reviseTicket(key, { draft, feedback: request.feedback, note: request.text, context })
      : await refineTicket(key, request.text, context)
  } catch (error) {
    // Surface what the user can act on (a bad key, a rate limit) rather than letting a
    // raw SDK error reach the dialog's error line.
    throw new Error(describeAnthropicError(error))
  }
}

// The shape of a created issue returned by roadmap_create_issue. Kept local
// because only the backend proxy references it as a return type here.
interface RoadmapIssueResult {
  number: number
  title: string
  body: string | null
  labels: { name: string; color: string }[]
}
