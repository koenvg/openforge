import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { resolveLocalProjectIdsByRepo } from '../review/pr/githubSyncClient'

function repoKey(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase()
}

const inFlightResolutions = new WeakMap<object, Promise<Map<string, string>>>()

export async function resolveProjectIdsByRepo(
  api: Pick<FrontendOpenForgeAPI, 'backend'>,
): Promise<Map<string, string>> {
  const existing = inFlightResolutions.get(api)
  if (existing) return existing

  const resolution = (async () => {
    const resolved = await resolveLocalProjectIdsByRepo(api)
    return new Map(Object.entries(resolved))
  })()
  const shared = resolution.finally(() => {
    if (inFlightResolutions.get(api) === shared) inFlightResolutions.delete(api)
  })
  inFlightResolutions.set(api, shared)
  return shared
}

export async function resolveProjectIdForRepo(
  api: Pick<FrontendOpenForgeAPI, 'backend'>,
  owner: string,
  name: string,
): Promise<string | null> {
  const projectIdsByRepo = await resolveProjectIdsByRepo(api)
  return projectIdsByRepo.get(repoKey(owner, name)) ?? null
}

export function projectRepoKey(owner: string, name: string): string {
  return repoKey(owner, name)
}
