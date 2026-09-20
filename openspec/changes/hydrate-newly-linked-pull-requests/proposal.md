## Why

A newly linked PR can appear with its title and URL but no CI or review details and only "Readiness Unknown". Linking currently reloads persisted data without scheduling the missing remote detail fetch, leaving users waiting for a later poll or pressing refresh.

## What Changes

- Keep newly linked PRs visible immediately, then schedule a targeted backend detail fetch without waiting for periodic polling or requiring the task panel to be mounted.
- Cover automatic discovery, manual linking, and recovery reconciliation through the same hydration behavior, while preserving their existing verification and ownership rules.
- Fetch and persist the existing PR detail set: canonical metadata and head, CI checks/statuses, reviews/requested reviewers, comments, and merge-readiness inputs.
- Distinguish first-fetch progress, incomplete/failed retrieval, and successfully fetched but genuinely unknown GitHub readiness. Preserve successfully fetched data during retries.
- Coalesce duplicate work, bound transient retries, honor rate-limit deadlines, and keep manual refresh and background recovery available.
- Test first-link-to-populated-card behavior, partial failures, delayed GitHub calculation, and stale result rejection.

## Capabilities

### New Capabilities

- `task-pull-request-hydration`: Prompt, view-independent hydration and truthful fetch status for newly linked task PRs.

### Modified Capabilities

None. The in-flight `link-task-pull-requests-from-events` change already separates immediate association from later enrichment; this change supplies that enrichment guarantee without changing discovery eligibility. No durable main spec currently defines first-link hydration.

## Impact

- Rust sidecar GitHub discovery, link entrypoints, reconciliation, polling, and PR persistence.
- Additive PR hydration state in persisted records and typed read contracts, including Plugin SDK types and affected host mappings.
- GitHub Sync plugin task PR cards and cache invalidation; shared status presentation only where needed to avoid conflating fetch state with merge readiness.
- Existing GitHub request coordination and event delivery, with no new service or dependency expected.
- Database migration and cross-boundary tests will be needed. No changes to PR association authority, task status, merge eligibility rules, polling intervals, or terminal parsing are proposed.
