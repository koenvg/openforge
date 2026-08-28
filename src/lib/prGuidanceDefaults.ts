import reviewGuidance from './reviewGuidance.md?raw'
import walkthroughGuidance from './walkthroughGuidance.md?raw'

/**
 * Defaults for the two configurable blocks of the "Generate Walkthrough + AI
 * Review" prompt (Global → Project override). Everything else in that prompt is
 * the output contract — the `{{…}}` placeholders that feed the agent the diff and
 * the JSON schema the parsers enforce — and is deliberately not exposed, because
 * a partial rewrite of it produces a silently broken generation rather than a
 * visible error.
 *
 * These are byte-for-byte copies of the github-sync plugin's own defaults (the
 * runtime fallback); `prGuidanceDefaults.test.ts` locks them together so the text
 * shown in Settings always matches what generation uses.
 */
export const DEFAULT_PR_REVIEW_GUIDANCE = reviewGuidance

export const DEFAULT_PR_WALKTHROUGH_GUIDANCE = walkthroughGuidance
