import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type {
  CreateIssueRequest,
  EditIssueRequest,
  RefineAvailability,
  RefineTicketRequest,
  RoadmapBoard,
  RoadmapConfig,
  RoadmapIssue,
  TicketDraft,
  UpdateLabelColorRequest,
} from './types'

export interface RoadmapClient {
  getBoard(projectId: string): Promise<RoadmapBoard>
  setValue(request: { projectId: string; issueNumber: number; value: number | null }): Promise<void>
  getConfig(projectId: string): Promise<RoadmapConfig>
  setColumnLabels(request: { projectId: string; labels: string[] }): Promise<void>
  createIssue(request: CreateIssueRequest): Promise<RoadmapIssue>
  editIssue(request: EditIssueRequest): Promise<void>
  updateLabelColor(request: UpdateLabelColorRequest): Promise<void>
  refineTicket(request: RefineTicketRequest): Promise<TicketDraft>
  refineAvailable(): Promise<boolean>
}

async function invokeBackend<TOutput>(
  api: Pick<FrontendOpenForgeAPI, 'backend'>,
  method: string,
  payload?: unknown,
): Promise<TOutput> {
  await api.backend.whenReady()
  return api.backend.invoke<TOutput>(method, payload)
}

export function createRoadmapClient(api: Pick<FrontendOpenForgeAPI, 'backend'>): RoadmapClient {
  return {
    getBoard: (projectId) => invokeBackend<RoadmapBoard>(api, 'roadmap_get_board', { projectId }),
    setValue: ({ projectId, issueNumber, value }) =>
      invokeBackend<void>(api, 'roadmap_set_value', { projectId, issueNumber, value }),
    getConfig: (projectId) => invokeBackend<RoadmapConfig>(api, 'roadmap_get_config', { projectId }),
    setColumnLabels: ({ projectId, labels }) =>
      invokeBackend<void>(api, 'roadmap_set_column_labels', { projectId, labels }),
    createIssue: (request) =>
      invokeBackend<{ issue: RoadmapIssue }>(api, 'roadmap_create_issue', request).then((r) => r.issue),
    editIssue: (request) => invokeBackend<void>(api, 'roadmap_edit_issue', request),
    updateLabelColor: (request) => invokeBackend<void>(api, 'roadmap_update_label_color', request),
    refineTicket: (request) => invokeBackend<TicketDraft>(api, 'roadmap_refine_ticket', request),
    refineAvailable: () =>
      invokeBackend<RefineAvailability>(api, 'roadmap_refine_available').then((r) => r.available),
  }
}
