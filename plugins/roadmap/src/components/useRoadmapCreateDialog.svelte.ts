import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { RefineTicketRequest, TicketDraft } from '../lib/types'
import { readApiKey } from '../lib/settings/apiKey'
import type { RoadmapBoardController } from './useRoadmapBoard.svelte'

export function useRoadmapCreateDialog(
  api: FrontendOpenForgeAPI,
  roadmap: RoadmapBoardController,
) {
  let open = $state(false)
  let initialLabels = $state<string[]>([])
  let hasApiKey = $state(false)

  function show(labels: string[] = []): void {
    initialLabels = [...labels]
    open = true
    // Re-read on every open because settings can change while the view remains mounted.
    void readApiKey(api.storage).then((key) => {
      hasApiKey = Boolean(key)
    })
  }

  function close(): void {
    open = false
    initialLabels = []
  }

  async function createIssue(title: string, body: string, labels: string[]): Promise<void> {
    if (await roadmap.createIssue(title, body, labels)) close()
  }

  async function refineTicketDraft(
    request: Omit<RefineTicketRequest, 'projectId' | 'repo' | 'repoLabels'>,
  ): Promise<TicketDraft> {
    return roadmap.refineTicketDraft(request)
  }

  return {
    get open() {
      return open
    },
    get initialLabels() {
      return initialLabels
    },
    get hasApiKey() {
      return hasApiKey
    },
    show,
    close,
    createIssue,
    refineTicketDraft,
  }
}

export type RoadmapCreateDialogController = ReturnType<typeof useRoadmapCreateDialog>
