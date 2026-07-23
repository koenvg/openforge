import type { LabelUsage } from '../lib/types'
import type { RoadmapBoardController } from './useRoadmapBoard.svelte'

export function useRoadmapColumnSettings(roadmap: RoadmapBoardController) {
  let open = $state(false)
  let labels = $state<LabelUsage[]>([])
  let columnLabels = $state<string[]>([])

  async function show(): Promise<void> {
    const config = await roadmap.loadColumnConfig()
    if (!config) return

    labels = config.labels
    columnLabels = config.columnLabels
    open = true
  }

  function close(): void {
    open = false
    roadmap.clearError()
  }

  async function save(nextColumnLabels: string[]): Promise<void> {
    if (await roadmap.saveColumns(nextColumnLabels)) open = false
  }

  return {
    get open() {
      return open
    },
    get labels() {
      return labels
    },
    get columnLabels() {
      return columnLabels
    },
    show,
    close,
    save,
  }
}

export type RoadmapColumnSettingsController = ReturnType<typeof useRoadmapColumnSettings>
