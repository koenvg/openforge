import { setWhisperModel } from '../../lib/ipc'
import { loadWhisperModelStatuses } from '../../lib/settingsConfig'
import type { WhisperModelSizeId, WhisperModelStatus } from '../../lib/types'

export function createSettingsWhisperController() {
  let modelStatuses = $state<WhisperModelStatus[]>([])
  let downloadingModel = $state<WhisperModelSizeId | null>(null)

  async function refreshModelStatuses(): Promise<void> {
    downloadingModel = null
    modelStatuses = await loadWhisperModelStatuses()
  }

  async function changeModel(newSize: string): Promise<void> {
    await setWhisperModel(newSize as WhisperModelSizeId)
    modelStatuses = await loadWhisperModelStatuses()
  }

  function beginModelDownload(modelSize: string): void {
    downloadingModel = modelSize as WhisperModelSizeId
  }

  return {
    get modelStatuses() { return modelStatuses },
    get downloadingModel() { return downloadingModel },
    clearDownloadError() { downloadingModel = null },
    refreshModelStatuses,
    changeModel,
    beginModelDownload,
  }
}

export type SettingsWhisperController = ReturnType<typeof createSettingsWhisperController>
