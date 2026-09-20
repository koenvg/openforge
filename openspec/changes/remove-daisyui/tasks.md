## 1. Inventory and baseline

- [ ] 1.1 Refresh KVG-4522/KVG-4671 task context and inventory actual class, selector, CSS-variable, and build-entry consumers across `src`, `packages`, `plugins`, and executable fixtures; deliver an updated `docs/ui-migration-inventory.md` with subsystem ownership, full variants/opacity, replacements, exclusions, unresolved expressions, and an explanation of the 929/905 count discrepancy.
- [ ] 1.2 Add failing scanner tests for conditional classes, class directives, script-held strings, directional/ring-offset/gradient utilities, arbitrary legacy variables, and false positives such as `select-none`; extend the existing checker and verify these cases pass while deliberately unresolved dynamic construction remains visible.
- [ ] 1.3 Capture pre-migration computed paint, control bounds, wrapping, focus, and feedback semantics for the design's representative host/package/plugin views under built-in and contributed themes; verify the recorded baseline includes viewport/font setup and the agreed geometry tolerance before modifying shared presentation.
- [ ] 1.4 Run the current affected-system checks listed in `design.md` to establish a baseline; record command results, missing services/browser dependencies, existing failures, and skipped suites without attributing them to this change.

## 2. Semantic utility foundation

- [ ] 2.1 Add failing compiled-CSS/browser tests for the inventoried utility families, chained interaction variants, slash opacity, and token updates under a namespaced contributed theme; verify tests fail because the new semantic utilities are not yet defined.
- [ ] 2.2 Add the inline `--color-of-*` mappings in `src/styles/semantic-utilities.css` and import them from `src/app.css` without removing compatibility CSS; verify the tests from 2.1 pass, direct-token consumers agree with utility consumers, and background opacity does not change child opacity.
- [ ] 2.3 Verify production class discovery for shared packages and bundled plugins using the semantic namespace, adjusting only the necessary source configuration; confirm a production bundle contains and renders representative classes from each affected subsystem and document the host-built versus standalone-plugin usage contract.

## 3. SDK feedback modules

- [ ] 3.1 Test-drive `LoadingIndicator.svelte` with caller-supplied naming or decorative behavior, the inventoried sizes, inherited color, and reduced motion; verify public-interface tests and a token-only browser fixture pass without Tailwind or daisyUI.
- [ ] 3.2 Test-drive `Alert.svelte` with semantic feedback variants, child content, native attributes, and caller-owned live-region policy; verify alert/status/non-live uses retain their roles, announcements, and baseline geometry in behavioral and browser tests.
- [ ] 3.3 Test-drive `Progress.svelte` with native value/max behavior, accessible naming, and indeterminate state; verify valid and omitted-value cases, native normalization, theme switching, reduced motion, and measured bounds without host CSS.
- [ ] 3.4 Register all three public exports through canonical SDK registries, include their assets and interface documentation, and extend packed-consumer coverage; verify SDK `check:entrypoints`, `build`, `test`, and `check:contract` pass and a packed token-only consumer renders the controls.

## 4. Existing SDK consumers

- [ ] 4.1 Migrate `MermaidDiagramPreview.svelte` actions and remaining legacy presentation to existing SDK controls and scoped semantic styling; verify its public callbacks, keyboard behavior, diagram interactions, theme switching, and action bounds remain unchanged.
- [ ] 4.2 Migrate `PluginViewState.svelte` loading, badge, and action presentation without changing its public interface; verify loading/error/retry behavior, accessible messages, token-only rendering, and baseline geometry.
- [ ] 4.3 Migrate the remaining inventoried SDK color/control consumers and executable SDK fixtures without introducing host utility requirements into public controls; verify the SDK inventory is clear and rerun SDK tests, build, entrypoint checks, and the packed publication contract.

## 5. PR review UI package

- [x] 5.1 Migrate diff/file-content alerts, loading states, and their associated colors in `packages/pr-review-ui`; verify loading/error/empty cases, expanded diff behavior, announcements, and baseline paint/bounds through focused tests and browser coverage.
- [x] 5.2 Migrate remaining review overview, comment/question, status-chip, and CSS-variable consumers in the package while preserving opacity and interaction states; verify review behavior tests and theme-switch browser assertions, with no unresolved package inventory entries.
- [ ] 5.3 Run `pnpm exec vitest run packages/pr-review-ui` and `pnpm --filter @openforge-app/pr-review-ui check`, plus production host review rendering; verify package checks pass and the review views remain styled before removing the adapter.

## 6. Terminal runtime presentation

- [ ] 6.1 Migrate inventoried terminal-runtime loading/color presentation and executable conformance styling without touching session ownership, PTY handling, or lifecycle; verify loading-state semantics, current terminal contents, and mounted theme changes in runtime/browser tests.
- [ ] 6.2 Run terminal-runtime `test`, `build`, and `conformance`; verify the package inventory is clear and record any environment-related conformance gaps separately from passing checks.

## 7. Bundled plugin slices

- [ ] 7.1 Migrate GitHub sync task-card and pull-request action/status consumers; verify focused plugin behavior tests and browser paint/bounds under light, dark, and contributed themes with all original opacity and disabled/hover states preserved.
- [ ] 7.2 Migrate GitHub sync review, walkthrough, questions, and coverage consumers; verify the remaining plugin inventory is clear and its full `test`, `typecheck`, and `build` scripts pass.
- [ ] 7.3 Migrate file-viewer loading, content, and remaining semantic color consumers without changing file navigation or selection; verify plugin `test` and `build`, mounted theme switching, and no new overflow or unresolved inventory entries.
- [ ] 7.4 Migrate task-browser loading and visual-feedback color consumers without altering browser/session behavior; verify plugin `test`, `typecheck`, and `build`, plus focused loading/feedback browser checks and a clear plugin inventory.
- [ ] 7.5 Migrate terminal-plugin presentation consumers without changing terminal ownership; verify plugin `test` and `build`, mounted terminal theme behavior, and a clear plugin inventory.

## 8. Host slices

- [x] 8.1 Migrate project-setup alerts and remaining project-setup color states while retaining its already-migrated SDK controls; verify creation/error/success flows, accessible feedback, keyboard focus, and baseline bounds across the theme matrix.
- [x] 8.2 Migrate `AttentionOverviewDialog.svelte` loading and semantic colors; verify existing attention actions, selection states, keyboard behavior, and narrow-dialog paint/geometry in focused tests and browser checks.
- [ ] 8.3 Migrate host task-detail and self-review feedback/color consumers, including provider loading views and terminal-shell presentation only; verify their relevant behavioral tests, preserved mounted state, and theme-aware diff/terminal rendering.
- [ ] 8.4 Migrate remaining focus-board, shell, and shared feedback consumers, including toast and model-download progress presentation; verify focused action/progress tests, accessible announcements, disabled states, and baseline browser geometry without changing domain logic.
- [ ] 8.5 Replace residual settings loading indicators in `SettingsView.svelte` and `ProviderSelectField.svelte` and any confirmed equivalent leftovers; verify loading/saving announcements, focus, and existing settings tests while confirming the diff does not repeat KVG-4522's caller migration or modify autosave logic.
- [ ] 8.6 Migrate remaining host content CSS and direct legacy variables, including geometry aliases such as `--radius-field`; verify the host consumer inventory is clear, relevant theme/content tests pass, and current token-defined fonts, radii, borders, and control sizes remain effective.

## 9. Integrated theme and removal readiness

- [ ] 9.1 Extend the existing settings theme browser regression with semantic probes while retaining legacy probes until removal; verify the real selection path preserves stable IDs, focus, edited input, and view state for OpenForge Light -> OpenForge Dark -> `com.example.ink:ink`.
- [ ] 9.2 Add or extend integrated browser coverage for all four built-ins and a second contributed palette/geometry, including a token mutation that cannot pass through built-in selectors; verify host, review, file-viewer, and terminal presentation follows the active tokens while mounted.
- [ ] 9.3 Exercise the representative views in normal and narrow layouts with hover, pressed, focus-visible, selected, invalid, disabled, opacity, and reduced-motion states; verify computed paint and measured bounds against the baseline and record screenshot evidence through the repository visual-review workflow.
- [ ] 9.4 Resolve remaining executable story/fixture/script consumers and inventory exceptions, including any newly discovered first-party subsystem; verify zero unexplained dynamic consumers and zero legacy dependencies outside the deliberately retained adapter and transitional regression probes, and run the checks for any additional affected package.

## 10. Remove daisyUI last

- [ ] 10.1 Preserve font aliases, global focus, reduced-motion rules, and any required base behavior in dependency-free global styles; verify equivalent computed behavior and color-scheme with the legacy adapter absent in a targeted browser fixture.
- [ ] 10.2 Remove the daisyUI plugin, both built-in theme blocks, root compatibility mappings, obsolete compact-control selectors, package dependency, and lockfile entry as one final removal slice; verify a fresh dependency installation and production build succeed without daisyUI resolution or emitted legacy styles.
- [ ] 10.3 Replace transitional legacy browser probes and compatibility-specific contract assertions with semantic coverage, and tighten the migration checker to reject reintroduction; verify the complete executable inventory is clean, intended negative-test/prose exclusions are documented, and the retained KVG-4671 theme-switch regression still passes.

## 11. Final affected-system validation and handoff

- [ ] 11.1 Run host `pnpm test`, `pnpm lint`, and `pnpm build`, SDK tests/build/entrypoint/publication checks, review checks, terminal-runtime checks/conformance, and every affected plugin's test/static-check/build scripts; verify the complete task diff passes the full affected-system scope from `design.md` and record all skips or pre-existing failures explicitly.
- [ ] 11.2 Run `pnpm build:plugins`, `node scripts/check-settings-themes.mjs`, the packed SDK token-only fixture, and the integrated browser matrix against final production assets; verify there is no daisyUI dependency, hidden host-CSS requirement, theme-ID special case, opacity loss, interaction regression, or geometry change.
- [ ] 11.3 Update migration documentation and release guidance for removed undocumented host classes, supported semantic utilities/SDK feedback imports, and rollback; verify examples use supported interfaces and record validation evidence, remaining gaps, and any genuine cleanup task IDs in task-scoped Handoff Notes.
