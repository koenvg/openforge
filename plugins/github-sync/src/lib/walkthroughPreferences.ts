// Persisted layout preferences for the Walkthrough tab.
//
// The step details (summary + "Ask the AI author" threads) sit above the diff, so
// collapsing them is the reviewer's main lever for giving the diff more vertical
// space. The choice sticks across steps, PRs, and app restarts.

export const WALKTHROUGH_STEP_DETAILS_STORAGE_KEY = 'openforge.githubSync.walkthroughStepDetailsExpanded.v1'

const DEFAULT_STEP_DETAILS_EXPANDED = true

export function loadWalkthroughStepDetailsExpanded(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(WALKTHROUGH_STEP_DETAILS_STORAGE_KEY)
    if (raw === null || raw === undefined) return DEFAULT_STEP_DETAILS_EXPANDED
    const parsed = JSON.parse(raw)
    return typeof parsed === 'boolean' ? parsed : DEFAULT_STEP_DETAILS_EXPANDED
  } catch {
    return DEFAULT_STEP_DETAILS_EXPANDED
  }
}

export function saveWalkthroughStepDetailsExpanded(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(WALKTHROUGH_STEP_DETAILS_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Persistence is best-effort; ignore storage failures (e.g. private mode).
  }
}
