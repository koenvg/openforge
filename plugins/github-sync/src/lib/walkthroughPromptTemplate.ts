import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { DEFAULT_WALKTHROUGH_PROMPT } from './walkthroughPrompt'

const PROMPT_CONFIG_KEY = 'pr_walkthrough_prompt'

/**
 * Resolve the configurable walkthrough + AI-review prompt template: per-project override,
 * else global default, else the built-in template. Mirrors how other hierarchical settings
 * (e.g. ai_provider) inherit global → project.
 *
 * Every surface that can start a generation resolves the template the same way, so a
 * walkthrough started from a pull-request row uses the same prompt wherever that row lives.
 */
export async function resolveWalkthroughPromptTemplate(
  api: Pick<FrontendOpenForgeAPI, 'config' | 'projectConfig'>,
  projectId: string | null,
): Promise<string> {
  const projectPrompt = projectId
    ? await api.projectConfig.get<string>(PROMPT_CONFIG_KEY, projectId)
    : null
  if (projectPrompt && projectPrompt.length > 0) return projectPrompt

  const globalPrompt = await api.config.get<string>(PROMPT_CONFIG_KEY)
  if (globalPrompt && globalPrompt.length > 0) return globalPrompt

  return DEFAULT_WALKTHROUGH_PROMPT
}
