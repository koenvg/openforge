/**
 * @process openforge/aviv-68-project-inheritance-clarity
 * @description Round 2a for issue #1280: make the project settings page's inheritance boundary
 *   legible (option A / card-as-boundary). Move AI provider + "default to worktrees" out of the
 *   General card INTO the grouped Configuration card so "in the Configuration card = inherited from
 *   global" is a reliable rule, with a single persistence path (fixing the latent debounced-save
 *   race). Preserve the provider's install-status/recovery UX. Label the project plugin panel as
 *   inheriting global defaults, and add project-mode helper text to the Configuration card.
 *   Frontend-only. TDD where there's testable logic; mandatory adversarial review before handoff.
 * @skill review .agents/skills/review/SKILL.md
 * @inputs { taskId: string, request: string }
 * @outputs { success: boolean, reviewApproved: boolean }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

const io = (taskCtx) => ({
  inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
  outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
});

export const implTask = defineTask('aviv-68-r2a/impl', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Make project settings inheritance boundary legible (option A)',
  description: 'Move provider + worktrees into the Configuration card; single persistence path; preserve provider UX; label plugin panel; project helper text.',
  agent: {
    prompt: {
      role: 'senior Svelte 5 / TypeScript engineer practising careful, test-guided refactoring',
      task: args.request,
      instructions: [
        'GOAL: on the PROJECT settings page, the grouped "Configuration" card (src/components/settings/HierarchicalSettingsCard.svelte, used in src/components/settings/SettingsView.svelte project branch) must become the single, complete home for all globally-inherited settings EXCEPT plugins — so "in the Configuration card = inherited from global; outside = project-specific" is a reliable rule.',
        'STEP 1 — move provider + worktrees into the card. In SettingsView.svelte project branch, remove "ai_provider" and "use_worktrees" from the HierarchicalSettingsCard excludeKeys (keep "plugins" excluded). Remove the AI Provider select and the "Default new tasks to worktrees" toggle from SettingsGeneralCard usage AND from SettingsGeneralCard.svelte itself (leaving it with project identity only: name, path, color). Remove the now-unused SettingsGeneralCard props/handlers (aiProvider, useWorktrees, installation-status props, onAiProviderChange, onUseWorktreesChange, onRefreshInstallationStatus) if they become dead there.',
        'STEP 2 — single persistence path (fix the latent race). Provider + worktrees must now persist ONLY through the card path handleProjectSettingChange -> setProjectConfig(projectId, key, value) (immediate write, updates projectRawOverrides so projectHierarchyValues recomputes). REMOVE ai_provider + use_worktrees from the debounced saveProjectSettings payload (settingsSaver.ts saveProjectSettings + captureCurrentSave in SettingsView) so the General-card debounced path no longer writes them. Confirm no code writes those two keys via two paths. (worktree/handoff task-creation seeding in AddTaskDialog is unaffected — it reads project-effective at create.)',
        'STEP 3 — preserve provider UX (do NOT regress it). The old General-card provider control shows install-status (installed/authenticated per provider, disables not-installed options, install links) and recovery ("switch to X" / refresh). Preserve this. Preferred approach: extract the provider selector + install-status/recovery UI into a small reusable component src/components/settings/ProviderSelectField.svelte, and render it for the ai_provider row of the Configuration card via an OPTIONAL Svelte 5 snippet prop on HierarchicalSettingsCard (e.g. a `providerField` snippet; when provided, the card renders it in place of the default <select> for the ai_provider row; when absent — e.g. global mode — the card falls back to the plain registry select, unchanged). Wire the snippet only on the PROJECT page, passing installation status + onAiProviderChange={(v)=>handleProjectSettingChange("ai_provider", v)} + refresh handler. Keep the GLOBAL Configuration card unchanged (plain provider select). If the snippet approach proves too costly, fall back to rendering the extracted ProviderSelectField as a distinct block inside the same Configuration card region — but the rich provider status/recovery UX MUST be preserved either way.',
        'STEP 4 — worktrees renders as the card\'s standard toggle (registry already defines it). Confirm its checked state comes from projectHierarchyValues and writes via handleProjectSettingChange.',
        'STEP 5 — plugins stay in PluginSettingsPanel (project). Add a small caption there (muted helper text) making clear plugin enablement inherits the global defaults and changes apply to this project only. Do NOT move plugin toggles into the Configuration card (they carry an install/reload lifecycle and the panel already does correct runtime activation via enable/disablePluginForProject).',
        'STEP 6 — project helper text. Extend the helperText $derived in HierarchicalSettingsCard so PROJECT mode also gets a one-line explanation, e.g. "Settings inherited from your global defaults. Change one to override it for this project only; use Default to global settings to go back to inheriting." (Global mode copy stays as-is.)',
        'Svelte 5 runes only ($state/$derived/$effect/$props with a local Props interface; snippets via {#snippet}/{@render}); on-prefixed callbacks; NEVER the legacy dispatcher. daisyUI v5 + Tailwind v4; NO hardcoded hex; focus ring-2 ring-primary rounded. All ipc via src/lib/ipc.ts. import type per verbatimModuleSyntax. No @ts-ignore / eslint-disable — fix root causes.',
        'TDD where testable (business logic only, NEVER CSS/visual): e.g. selecting a provider or toggling worktrees in project mode writes via setProjectConfig once (single path); saveProjectSettings no longer writes ai_provider/use_worktrees; reset still clears them. Update coupled tests you break (SettingsView.test.ts, SettingsGeneralCard.test.ts, settingsSaver.test.ts, AddTaskDialog.test.ts, PluginSettingsPanel tests). Do not weaken tests into meaninglessness.',
        'Commit logically with clear messages. Never add a Claude co-author or mention Claude/Anthropic.',
      ],
      acceptanceCriteria: [
        'On the project page, the Configuration card renders cleanup, title-update, handoff, task_id_prefix, github_poll_interval, AI provider, and default-to-worktrees; the General card no longer shows provider/worktrees; plugins remain in the labeled plugin panel.',
        'Provider + worktrees persist through exactly one path (setProjectConfig via the card); saveProjectSettings no longer writes them; no dual-write race remains.',
        'Provider install-status/recovery UX is preserved (not regressed to a bare select).',
        'Project-mode Configuration card shows explanatory helper text; plugin panel labeled as inheriting global defaults.',
        'tsc clean; focused settings/AddTaskDialog/plugin tests green.',
      ],
    },
  },
  labels: ['agent', 'frontend', 'refactor', 'tdd'],
  io: io(taskCtx),
}));

export const verifyTask = defineTask('aviv-68-r2a/verify', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Verify — tsc + focused vitest',
  description: 'Types clean and settings/dialog/plugin tests pass.',
  shell: {
    command: 'pnpm exec tsc --noEmit && pnpm exec vitest run src/components/settings src/components/AddTaskDialog.test.ts src/components/plugin src/lib/hierarchicalSettings.test.ts src/lib/settingsSaver.test.ts src/lib/settingsConfig.test.ts',
    cwd: '.',
  },
  labels: ['shell', 'verification'],
  io: io(taskCtx),
}));

export const reviewTask = defineTask('aviv-68-r2a/review', (args, taskCtx) => ({
  kind: 'skill',
  title: 'Adversarial review of the inheritance-boundary refactor',
  description: 'Assume a re-introduced save race, regressed provider UX, dead code, or a broken boundary until proven otherwise.',
  skill: {
    name: 'review',
    input: {
      task: args.request,
      checklist: [
        'Confirm ai_provider + use_worktrees now persist via exactly ONE path (card -> setProjectConfig) and are NO LONGER written by the debounced saveProjectSettings — trace both. The old dual-write clobber race must be gone, not relocated.',
        'Confirm the provider control still shows install-status (installed/authenticated, disables not-installed options) and recovery — no regression to a bare select. Confirm global-mode provider select is unchanged.',
        'Confirm the Configuration card (project) now contains provider + worktrees and the General card no longer does; plugins remain in the (now-labeled) PluginSettingsPanel and were NOT duplicated into the card.',
        'Confirm no dead code left behind (unused SettingsGeneralCard props/handlers, unused state, unused imports).',
        'Confirm reset ("Default to global settings") still clears provider/worktrees overrides and the card reflects re-inherited values.',
        'Confirm Svelte 5 runes/snippets used correctly, no hex, and tests assert business logic only (no CSS/visual assertions).',
      ],
    },
  },
  labels: ['skill', 'review', 'oracle'],
  io: io(taskCtx),
}));

export const reviewFixTask = defineTask('aviv-68-r2a/review-fix', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Fix blocking review findings',
  description: 'Apply required fixes from the review gate.',
  agent: {
    prompt: {
      role: 'senior engineer resolving review blockers',
      task: 'Fix every blocking finding unless demonstrably a false positive (explain with evidence). Keep scope tight. Add/adjust a test that would have caught each real blocker, then re-run focused verification.',
      instructions: ['Preserve the single-persistence-path and provider-UX invariants while fixing.'],
    },
  },
  labels: ['agent', 'fix', 'review'],
  io: io(taskCtx),
}));

export const finalVerificationTask = defineTask('aviv-68-r2a/final-verification', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Final verification — tsc + full vitest + diff hygiene',
  description: 'Frontend-only change: full typecheck, full vitest, and clean diff.',
  shell: {
    command: 'pnpm exec tsc --noEmit && pnpm test && git diff --check',
    cwd: '.',
  },
  labels: ['shell', 'verification', 'final'],
  io: io(taskCtx),
}));

export async function process(inputs = {}, ctx) {
  const request =
    inputs.request ||
    'Make the project settings inheritance boundary legible (option A): move AI provider and default-to-worktrees into the Configuration card with a single persistence path, preserve provider install-status UX, label the plugin panel as inheriting global defaults, and add project-mode helper text.';

  ctx.log('info', 'Implement inheritance-boundary refactor');
  await ctx.task(implTask, { request });
  await ctx.task(verifyTask, { request });

  ctx.log('info', 'Mandatory adversarial review gate');
  const review = await ctx.task(reviewTask, { request });
  const verdict = String(review?.verdict || '').toLowerCase();
  const blockers = Array.isArray(review?.blockers) ? review.blockers : [];
  const needsFix = verdict === 'changes_requested' || blockers.length > 0;
  let reviewApproved = !needsFix;
  if (needsFix) {
    ctx.log('info', 'Review requested changes — applying fixes');
    await ctx.task(reviewFixTask, { request, review });
    reviewApproved = true;
  }

  ctx.log('info', 'Final verification gates');
  await ctx.task(finalVerificationTask, { request });

  return { success: true, reviewApproved };
}
