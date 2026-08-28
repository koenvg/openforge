import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { DEFAULT_REVIEW_GUIDANCE, DEFAULT_WALKTHROUGH_GUIDANCE } from './walkthroughPrompt'

export const REVIEW_GUIDANCE_CONFIG_KEY = 'pr_review_guidance'
export const WALKTHROUGH_GUIDANCE_CONFIG_KEY = 'pr_walkthrough_guidance'

export interface WalkthroughGuidance {
  reviewGuidance: string
  walkthroughGuidance: string
}

/**
 * Resolve one guidance setting: per-project override, else global, else the
 * shipped default. Mirrors how other hierarchical settings (e.g. `ai_provider`)
 * inherit global → project.
 *
 * Note the present-vs-absent test rather than the empty-vs-non-empty one used by
 * most settings. These fields ship with real content, so clearing the box is a
 * deliberate "no extra guidance" and must not silently restore the default. That
 * is only safe because the output contract lives in the template, not here.
 */
async function resolveOne(
  api: Pick<FrontendOpenForgeAPI, 'config' | 'projectConfig'>,
  projectId: string | null,
  key: string,
  shippedDefault: string,
): Promise<string> {
  const projectValue = projectId ? await api.projectConfig.get<string>(key, projectId) : null
  if (projectValue != null) return projectValue

  const globalValue = await api.config.get<string>(key)
  if (globalValue != null) return globalValue

  return shippedDefault
}

/**
 * The two user-configurable blocks the walkthrough prompt embeds. Every surface
 * that can start a generation resolves them the same way, so a walkthrough
 * started from a pull-request row uses the same guidance wherever that row lives.
 */
export async function resolveWalkthroughGuidance(
  api: Pick<FrontendOpenForgeAPI, 'config' | 'projectConfig'>,
  projectId: string | null,
): Promise<WalkthroughGuidance> {
  const [reviewGuidance, walkthroughGuidance] = await Promise.all([
    resolveOne(api, projectId, REVIEW_GUIDANCE_CONFIG_KEY, DEFAULT_REVIEW_GUIDANCE),
    resolveOne(api, projectId, WALKTHROUGH_GUIDANCE_CONFIG_KEY, DEFAULT_WALKTHROUGH_GUIDANCE),
  ])
  return { reviewGuidance, walkthroughGuidance }
}
