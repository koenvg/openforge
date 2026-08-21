import promptTemplate from './prWalkthroughPrompt.md?raw'

/**
 * The built-in template for the "Generate Walkthrough + AI Review" prompt, used as
 * the default value of the `pr_walkthrough_prompt` hierarchical setting (Global →
 * Project override). This is a byte-for-byte copy of the github-sync plugin's own
 * `walkthroughPrompt.md` (the runtime fallback); `prWalkthroughPrompt.test.ts`
 * locks the two together so the prompt shown in Settings always matches the one
 * generation actually uses when the setting is left at its default.
 */
export const DEFAULT_PR_WALKTHROUGH_PROMPT = promptTemplate
