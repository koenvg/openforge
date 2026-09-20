import { computeEffectiveProjectSettings } from './hierarchicalSettings'
import { getConfig, getProjectConfig } from './ipc/config'

const SETTING_KEY = 'open_attention_overview_on_send'

let attentionOverviewOpener: (() => void) | null = null
let readProjectId: () => string | null = () => null

export function registerAttentionOverviewOpener(options: {
  open: () => void
  getProjectId: () => string | null
}): () => void {
  attentionOverviewOpener = options.open
  readProjectId = options.getProjectId
  return () => {
    if (attentionOverviewOpener === options.open) {
      attentionOverviewOpener = null
      readProjectId = () => null
    }
  }
}

export function notifySessionMessageSent(): void {
  const open = attentionOverviewOpener
  if (!open) return
  void maybeOpenAttentionOverviewOnSend(open, readProjectId())
}

export async function maybeOpenAttentionOverviewOnSend(
  open: () => void,
  projectId: string | null,
): Promise<void> {
  try {
    if (await isOpenAttentionOverviewOnSendEnabled(projectId)) open()
  } catch (error) {
    console.error('[openAttentionOverviewOnSend] Failed to resolve setting:', error)
  }
}

async function isOpenAttentionOverviewOnSendEnabled(projectId: string | null): Promise<boolean> {
  const [globalValue, projectValue] = await Promise.all([
    getConfig(SETTING_KEY),
    projectId ? getProjectConfig(projectId, SETTING_KEY) : Promise.resolve(null),
  ])
  const effective = computeEffectiveProjectSettings(
    globalValue != null ? { [SETTING_KEY]: globalValue } : {},
    { [SETTING_KEY]: projectValue },
  )
  return effective[SETTING_KEY] === 'true'
}
