import type { ImplementationRun, JsonObject } from '@openforge-app/plugin-sdk'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { BoardCard, RoadmapIssueTaskLink } from './board'

interface StartRoadmapIssueActionRequest {
  projectId: string
  repo: string
  card: BoardCard
}

interface BuildIssueTaskPromptRequest {
  repo: string
  card: BoardCard
}

export interface RoadmapTaskIssueLink {
  issueNumber: number
  link: RoadmapIssueTaskLink
}

const ISSUE_TASK_LINKS_KEY = 'issueTaskLinks'
const TASK_ISSUE_LINK_KEY = 'roadmapIssueLink'

function isRoadmapIssueTaskLink(value: unknown): value is RoadmapIssueTaskLink {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.taskId === 'string' &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.workspacePath === 'string'
  )
}

function normalizeRoadmapIssueTaskLink(value: RoadmapIssueTaskLink): RoadmapIssueTaskLink {
  return {
    taskId: value.taskId,
    sessionId: value.sessionId,
    workspacePath: value.workspacePath,
    repo: typeof (value as { repo?: unknown }).repo === 'string' ? (value as { repo: string }).repo : null,
    title: typeof (value as { title?: unknown }).title === 'string' ? (value as { title: string }).title : null,
  }
}

function serializeRoadmapIssueTaskLink(link: RoadmapIssueTaskLink): JsonObject {
  return {
    taskId: link.taskId,
    sessionId: link.sessionId,
    workspacePath: link.workspacePath,
    repo: link.repo,
    title: link.title,
  }
}

function isRoadmapTaskIssueLink(value: unknown): value is RoadmapTaskIssueLink {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.issueNumber === 'number' && Number.isInteger(candidate.issueNumber) && isRoadmapIssueTaskLink(candidate.link)
}

function parseStoredIssueTaskLinks(value: unknown): Record<number, RoadmapIssueTaskLink> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}

  const links: Record<number, RoadmapIssueTaskLink> = {}
  for (const [issueNumber, link] of Object.entries(parsed)) {
    const issue = Number(issueNumber)
    if (Number.isInteger(issue) && issue > 0 && isRoadmapIssueTaskLink(link)) {
      links[issue] = normalizeRoadmapIssueTaskLink(link)
    }
  }
  return links
}

export async function loadRoadmapIssueTaskLinks(
  api: FrontendOpenForgeAPI,
  projectId: string | null,
): Promise<Record<number, RoadmapIssueTaskLink>> {
  if (!projectId) return {}
  try {
    const stored = await api.storage.project(projectId).get(ISSUE_TASK_LINKS_KEY)
    return parseStoredIssueTaskLinks(stored)
  } catch {
    return {}
  }
}

export function findRoadmapIssueTaskLinkForTask(
  links: Record<number, RoadmapIssueTaskLink>,
  taskId: string,
): { issueNumber: number; link: RoadmapIssueTaskLink } | null {
  for (const [issueNumber, link] of Object.entries(links)) {
    if (link.taskId === taskId) return { issueNumber: Number(issueNumber), link }
  }
  return null
}

function parseStoredTaskIssueLink(value: unknown): RoadmapTaskIssueLink | null {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (!isRoadmapTaskIssueLink(parsed) || parsed.issueNumber <= 0) return null
  return { issueNumber: parsed.issueNumber, link: normalizeRoadmapIssueTaskLink(parsed.link) }
}

export async function loadRoadmapIssueTaskLinkForTask(
  api: FrontendOpenForgeAPI,
  projectId: string | null,
  taskId: string,
): Promise<RoadmapTaskIssueLink | null> {
  try {
    const stored = await api.storage.task(taskId).get(TASK_ISSUE_LINK_KEY)
    const taskLink = parseStoredTaskIssueLink(stored)
    if (taskLink) return taskLink
  } catch {
    // Fall back to the legacy project map below.
  }

  if (!projectId) return null
  const projectLinks = await loadRoadmapIssueTaskLinks(api, projectId)
  return findRoadmapIssueTaskLinkForTask(projectLinks, taskId)
}
async function saveRoadmapIssueTaskLink(
  api: FrontendOpenForgeAPI,
  projectId: string,
  issueNumber: number,
  run: ImplementationRun,
  repo: string,
  title: string,
): Promise<void> {
  const link: RoadmapIssueTaskLink = {
    taskId: run.taskId,
    sessionId: run.sessionId,
    workspacePath: run.workspacePath,
    repo,
    title,
  }
  await api.storage.task(run.taskId).set(TASK_ISSUE_LINK_KEY, {
    issueNumber,
    link: serializeRoadmapIssueTaskLink(link),
  })

  const links = await loadRoadmapIssueTaskLinks(api, projectId)
  links[issueNumber] = link

  const stored: JsonObject = {}
  for (const [issue, link] of Object.entries(links)) {
    stored[issue] = serializeRoadmapIssueTaskLink(link)
  }
  await api.storage.project(projectId).set(ISSUE_TASK_LINKS_KEY, stored)
}

export function buildIssueTaskPrompt({ repo, card }: BuildIssueTaskPromptRequest): string {
  const lines = [
    `Implement this GitHub issue #${card.issueNumber}: ${card.title}`,
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
    }),
  })

  const run = await api.tasks.startImplementation({ taskId: task.id })
  await saveRoadmapIssueTaskLink(api, request.projectId, request.card.issueNumber, run, request.repo, request.card.title)
  await api.navigation.navigate({ projectId: request.projectId, viewId: 'board', taskId: task.id })
  return run
}
