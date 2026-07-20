/**
 * @process openforge/aviv-68-global-plugin-dedup
 * @description Round 2b for issue #1280: remove the plugin duplication on the GLOBAL settings page.
 *   Today plugins appear twice on the global page — enable-by-default toggles inside the grouped
 *   Configuration card AND the GlobalPluginSettingsPanel (install/reload/uninstall). Make it
 *   symmetric with the project page: exclude `plugins` from the global Configuration card and
 *   surface the per-plugin enable-by-default toggle on the GlobalPluginSettingsPanel rows (wired to
 *   getGlobalPluginDefaults/setGlobalPluginDefault). Frontend-only. TDD where testable; mandatory
 *   adversarial review before handoff.
 * @skill review .agents/skills/review/SKILL.md
 * @inputs { taskId: string, request: string }
 * @outputs { success: boolean, reviewApproved: boolean }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

const io = (taskCtx) => ({
  inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
  outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
});

export const implTask = defineTask('aviv-68-r2b/impl', (args, taskCtx) => ({
  kind: 'agent',
  title: 'De-duplicate plugins on the global settings page',
  description: 'Exclude plugins from the global Configuration card; add enable-by-default toggle to GlobalPluginSettingsPanel rows.',
  agent: {
    prompt: {
      role: 'senior Svelte 5 / TypeScript engineer practising careful, test-guided UI work',
      task: args.request,
      instructions: [
        'GOAL: on the GLOBAL settings page, plugins currently appear in TWO places — the grouped "Configuration" card (HierarchicalSettingsCard mode="global", which renders the plugins control because it has no excludeKeys) AND the GlobalPluginSettingsPanel below it. Make it symmetric with the project page (which excludes plugins from its Configuration card and keeps them only in the dedicated panel).',
        'STEP 1: In src/components/settings/SettingsView.svelte, add excludeKeys={[\'plugins\']} to the GLOBAL-mode HierarchicalSettingsCard mount, and stop passing pluginRows/onPluginToggle to it (they become unused there). Do NOT change the project-mode card.',
        'STEP 2: Move the per-plugin enable-by-default control into src/components/plugin/GlobalPluginSettingsPanel.svelte. Each installed-plugin row (the {#each pluginsList} block) gets a daisyUI toggle labeled to indicate it sets the GLOBAL default (e.g. aria-label "Enable by default: {name}", data-testid "plugin-default-{id}") reflecting the plugin\'s global default (globalDefault(pluginId) ?? isBuiltin) and calling setGlobalPluginDefault(pluginId, enabled) on change. Reuse SettingsView\'s existing global-default state + handler by passing them down as props (the SettingsView already loads getGlobalPluginDefaults into globalPluginDefaults / builds globalPluginRows / has handleGlobalPluginToggle) — add props like `pluginDefaults` (a map/set of id->enabled, or reuse the {id,name,enabled}[] rows) and `onToggleDefault(pluginId, enabled)` to GlobalPluginSettingsPanel, and wire them from SettingsView. Keep install/reload/uninstall/diagnostics exactly as-is.',
        'STEP 3: Confirm GlobalPluginSettingsPanel is only used on the global page (grep). The enable-by-default toggle is distinct from the project-scoped enablement (enabledPluginIds) the panel already references for diagnostics — do not conflate them; this toggle drives the global_plugins default layer only.',
        'STEP 4: The plugins registry entry stays levels: [\'global\',\'project\'] (unchanged) — it is simply excluded from BOTH Configuration cards now; the dedicated panels own the plugin controls on each page. Keep the project-page plugin caption and behavior unchanged.',
        'Svelte 5 runes only ($state/$derived/$effect/$props with a local Props interface); on-prefixed callbacks; no legacy dispatcher. daisyUI v5 + Tailwind v4; NO hardcoded hex; focus ring-2 ring-primary rounded. All ipc via src/lib/ipc.ts. import type per verbatimModuleSyntax. No @ts-ignore/eslint-disable.',
        'TDD where testable (business logic only, NEVER CSS/visual): the global Configuration card no longer renders the plugins control (e.g. no plugin-default toggles under section-configuration in global mode); GlobalPluginSettingsPanel renders an enable-by-default toggle per plugin that calls setGlobalPluginDefault with the right args and reflects builtin-vs-global-default state. Update any coupled tests (SettingsView global plugins test, GlobalPluginSettingsPanel tests).',
        'Commit logically with a clear message. Never add a Claude co-author or mention Claude/Anthropic.',
      ],
      acceptanceCriteria: [
        'Global page shows plugins in exactly ONE place: the GlobalPluginSettingsPanel, whose rows now carry an enable-by-default toggle wired to setGlobalPluginDefault.',
        'The global Configuration card no longer renders plugin toggles (excludeKeys includes plugins); project page behavior unchanged.',
        'Global and project pages are now symmetric (Configuration card excludes plugins on both; dedicated panel owns plugin controls on both).',
        'tsc clean; focused settings/plugin tests green.',
      ],
    },
  },
  labels: ['agent', 'frontend', 'tdd'],
  io: io(taskCtx),
}));

export const verifyTask = defineTask('aviv-68-r2b/verify', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Verify — tsc + focused vitest',
  description: 'Types clean and settings/plugin tests pass.',
  shell: {
    command: 'pnpm exec tsc --noEmit && pnpm exec vitest run src/components/settings src/components/plugin src/lib/hierarchicalSettings.test.ts',
    cwd: '.',
  },
  labels: ['shell', 'verification'],
  io: io(taskCtx),
}));

export const reviewTask = defineTask('aviv-68-r2b/review', (args, taskCtx) => ({
  kind: 'skill',
  title: 'Adversarial review of the global plugin de-duplication',
  description: 'Assume the enable-default toggle is mis-wired (project vs global), a leftover duplicate, or a broken builtin-default until proven otherwise.',
  skill: {
    name: 'review',
    input: {
      task: args.request,
      checklist: [
        'Confirm plugins now render in exactly ONE place on the GLOBAL page: no plugin toggles remain in the global Configuration card (excludeKeys includes plugins; pluginRows/onPluginToggle no longer passed to the global card), and GlobalPluginSettingsPanel carries the enable-by-default toggle.',
        'Confirm the new toggle drives the GLOBAL default layer (setGlobalPluginDefault / global_plugins), NOT the project-scoped enablement (enablePluginForProject/enabledPluginIds). These must not be conflated.',
        'Confirm the toggle reflects the correct default state: global_plugins row value if present, else builtin default.',
        'Confirm global/project symmetry: the project Configuration card still excludes plugins and PluginSettingsPanel still owns project plugins; project behavior is unchanged.',
        'Confirm install/reload/uninstall/diagnostics still work; GlobalPluginSettingsPanel is global-only (no other usage broken).',
        'Runes/no-hex conventions; tests assert business logic only (no CSS/visual assertions).',
      ],
    },
  },
  labels: ['skill', 'review', 'oracle'],
  io: io(taskCtx),
}));

export const reviewFixTask = defineTask('aviv-68-r2b/review-fix', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Fix blocking review findings',
  description: 'Apply required fixes from the review gate.',
  agent: {
    prompt: {
      role: 'senior engineer resolving review blockers',
      task: 'Fix every blocking finding unless demonstrably a false positive (explain with evidence). Keep scope tight. Add/adjust a test that would have caught each real blocker, then re-run focused verification.',
      instructions: ['Preserve the global-vs-project plugin distinction and the single-home invariant while fixing.'],
    },
  },
  labels: ['agent', 'fix', 'review'],
  io: io(taskCtx),
}));

export const finalVerificationTask = defineTask('aviv-68-r2b/final-verification', (_args, taskCtx) => ({
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
    'Remove plugin duplication on the global settings page: exclude plugins from the global Configuration card and add a per-plugin enable-by-default toggle to GlobalPluginSettingsPanel (wired to setGlobalPluginDefault), symmetric with the project page.';

  ctx.log('info', 'Implement global plugin de-duplication');
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
