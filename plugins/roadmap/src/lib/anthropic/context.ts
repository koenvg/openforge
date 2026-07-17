// Builds the model-facing repo snapshot that grounds a draft.
//
// Ported from the github-roadmap reference implementation (src/lib/groq/context.ts).
// The reference fetches description + labels + README from the GitHub API through an
// authenticated Octokit. Here:
//
//   - repo and labels ride in on the refine request: the board the dialog was opened
//     from already loaded them, so re-fetching would spend a network round trip to
//     learn what the caller already knows.
//   - the README is read off the project's checkout instead of the GitHub API. It is
//     the same file, and a local read is faster than the round trip it replaces.
//   - description has no local equivalent (it lives in GitHub's repo metadata), so it
//     is left null. contextBlock() already omits the line when it's absent.

import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { RepoContext } from './client'

const TTL_MS = 10 * 60 * 1000
const README_MAX_CHARS = 2500
// GitHub resolves any of these to "the README"; a checkout only has whichever one
// the repo actually committed, so try them in descending order of likelihood.
const README_CANDIDATES = ['README.md', 'readme.md', 'README', 'README.markdown', 'README.rst']

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max).trimEnd()}\n…(truncated)` : s
}

// The README rarely changes within a session, so cache it per project with a short
// TTL to keep a refine and its follow-up revisions from re-reading it each time.
const cache = new Map<string, { at: number; readme: string }>()

async function readReadme(openforge: BackendOpenForgeAPI, projectId: string): Promise<string> {
  for (const path of README_CANDIDATES) {
    try {
      const file = await openforge.fs.readFile({ projectId, path })
      if (file.type === 'text' && file.content.trim()) return file.content
    } catch {
      // Missing or unreadable — try the next spelling.
    }
  }
  return ''
}

export interface RepoContextRequest {
  projectId: string
  /** owner/name, as the board resolved it. */
  repo: string
  /** Every label in the repo, not just the ones selected for this ticket. */
  repoLabels: string[]
}

// Grounding is best-effort: a project with no readable README still gets a draft,
// just a less project-specific one. It must never fail the refine.
export async function loadRepoContext(
  openforge: BackendOpenForgeAPI,
  { projectId, repo, repoLabels }: RepoContextRequest,
): Promise<RepoContext> {
  const hit = cache.get(projectId)
  let readme: string
  if (hit && Date.now() - hit.at < TTL_MS) {
    readme = hit.readme
  } else {
    readme = truncate((await readReadme(openforge, projectId)).trim(), README_MAX_CHARS)
    cache.set(projectId, { at: Date.now(), readme })
  }
  return { repo, description: null, readme, labels: repoLabels }
}

/** Exposed for tests. */
export function clearRepoContextCache(): void {
  cache.clear()
}
