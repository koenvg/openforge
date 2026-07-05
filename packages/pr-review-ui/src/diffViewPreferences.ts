// Persisted user preferences for the diff viewer.
//
// Line wrapping defaults to OFF (the original behavior). The reviewer's toggle choice is
// remembered across PRs, projects, and app restarts, so enabling wrap once makes it stick
// everywhere until toggled back off.

export const DIFF_VIEW_WRAP_STORAGE_KEY = 'openforge.prReviewUi.diffViewWrap.v1'

const DEFAULT_DIFF_VIEW_WRAP = false

export function loadDiffViewWrap(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(DIFF_VIEW_WRAP_STORAGE_KEY)
    if (raw === null || raw === undefined) return DEFAULT_DIFF_VIEW_WRAP
    const parsed = JSON.parse(raw)
    return typeof parsed === 'boolean' ? parsed : DEFAULT_DIFF_VIEW_WRAP
  } catch {
    return DEFAULT_DIFF_VIEW_WRAP
  }
}

export function saveDiffViewWrap(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(DIFF_VIEW_WRAP_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Persistence is best-effort; ignore storage failures (e.g. private mode).
  }
}
