import type { Action, ImplementationRun } from '@openforge-app/plugin-sdk'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { BoardCard } from './board'

export const DEFAULT_ROADMAP_ACTIONS: Action[] = [
  {
    id: 'builtin-go',
    name: 'Go',
    prompt: '',
    builtin: true,
    enabled: true,
  },
]

interface StartRoadmapIssueActionRequest {
  projectId: string
  repo: string
  card: BoardCard
  actionPrompt: string
}

interface BuildIssueTaskPromptRequest {
  repo: string
  card: BoardCard
  actionPrompt: string
}

function isAction(value: unknown): value is Action {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.prompt === 'string' &&
    typeof candidate.builtin === 'boolean' &&
    typeof candidate.enabled === 'boolean'
  )
}

function parseStoredActions(value: unknown): Action[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ROADMAP_ACTIONS

  const actions = parsed
    .filter(isAction)
    .map(({ id, name, prompt, builtin, enabled }) => ({ id, name, prompt, builtin, enabled }))

  return actions.length > 0 ? actions : DEFAULT_ROADMAP_ACTIONS
}

export function getEnabledRoadmapActions(value: unknown): Action[] {
  try {
    return parseStoredActions(value)
      .filter((action) => action.enabled)
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return DEFAULT_ROADMAP_ACTIONS
  }
}

export async function loadRoadmapActions(api: FrontendOpenForgeAPI, projectId: string | null): Promise<Action[]> {
  if (!projectId) return []
  const stored = await api.projectConfig.get('actions', projectId)
  return getEnabledRoadmapActions(stored)
}

export function buildIssueTaskPrompt({ repo, card, actionPrompt }: BuildIssueTaskPromptRequest): string {
  const instruction = actionPrompt.trim() || 'Implement this'
  const lines = [
    `${instruction} GitHub issue #${card.issueNumber}: ${card.title}`,
    '',
    `Repository: ${repo}`,
    `Issue URL: https://github.com/${repo}/issues/${card.issueNumber}`,
  ]

  if (card.labels.length > 0) {
    lines.push(`Labels: ${card.labels.join(', ')}`)
  }

  if (card.value !== null) {
    lines.push(`Roadmap value: ${card.value}`)
  }

  const body = card.body?.trim()
  if (body) {
    lines.push('', 'Issue body:', body)
  }

  return lines.join('\n')
}

export async function startRoadmapIssueAction(
  api: FrontendOpenForgeAPI,
  request: StartRoadmapIssueActionRequest,
): Promise<ImplementationRun> {
  const task = await api.tasks.create({
    projectId: request.projectId,
    initialPrompt: buildIssueTaskPrompt({
      repo: request.repo,
      card: request.card,
      actionPrompt: request.actionPrompt,
    }),
  })

  const run = await api.tasks.startImplementation({ taskId: task.id })
  await api.navigation.navigate({ projectId: request.projectId, viewId: 'board', taskId: task.id })
  return run
}
