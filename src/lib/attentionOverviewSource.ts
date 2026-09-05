import { get } from 'svelte/store'
import { projects, activeProjectId, reviewPrs, globalExcludedPrRepos, ticketPrs, hiddenProjectIds, attentionCountByProject } from './stores'
import { getTaskLanes, getProjectConfig, getConfig, setConfig } from './ipc'
import { buildAttentionOverview, laneRowsByFilter } from './attentionOverview'
import type { AttentionOverview, AttentionTaskReference } from './attentionOverview'
import { subscribeDebounced } from './attentionOverviewRefresh'
import type { AttentionOverviewSource } from './attentionOverviewInteraction'

async function load(): Promise<{ overview: AttentionOverview; activeId: string | null }> {
  const projectList = get(projects)
  const nextActiveId = get(activeProjectId)

  const laneRows = await getTaskLanes()
  const taskReferencesById = new Map<string, AttentionTaskReference>()
  for (const rows of Object.values(laneRows)) {
    for (const row of rows) {
      taskReferencesById.set(row.task_id, { id: row.task_id, projectId: row.project_id })
    }
  }
  const allTasks = Array.from(taskReferencesById.values())
  const resolvedRepoByProject = new Map<string, string | null>()
  await Promise.all(
    projectList.map(async (project) => {
      const repoRaw = await getProjectConfig(project.id, 'resolved_repo').catch(() => null)
      resolvedRepoByProject.set(
        project.id,
        typeof repoRaw === 'string' && repoRaw.includes('/') ? repoRaw : null,
      )
    }),
  )

  return {
    overview: buildAttentionOverview({
      projects: projectList,
      allTasks,
      taskRowsByLane: laneRowsByFilter(laneRows),
      reviewPrs: get(reviewPrs),
      excludedRepos: get(globalExcludedPrRepos),
      resolvedRepoByProject,
      hiddenProjectIds: get(hiddenProjectIds),
    }),
    activeId: nextActiveId,
  }
}

/** Live renderer adapter. Store bursts coalesce before asking for a fresh lane projection. */
export const attentionOverviewSource: AttentionOverviewSource = {
  load,
  readConfig: getConfig,
  writeConfig: setConfig,
  subscribeChanges(onChange) {
    return subscribeDebounced(
      [projects, reviewPrs, ticketPrs, hiddenProjectIds, globalExcludedPrRepos, activeProjectId, attentionCountByProject],
      onChange,
      250,
    )
  },
}
