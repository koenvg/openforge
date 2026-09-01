## 0. Architecture exploration and framework gate

- [ ] 0.1 Run `/opsx-explore add-angular-extensible-theming` before executable implementation, define the light and dark visual references, semantic token taxonomy, geometry, typography, motion, and representative component anatomy, and verify the agreed decisions are recorded in `design.md`.
- [ ] 0.2 Build disposable Bits UI dialog and select spikes through both the host renderer and a packed external-plugin fixture; verify Svelte 5 compatibility, one shared Svelte runtime, portals, CSS extraction, bundle impact, keyboard behavior, focus management, and accessible names and states, then record the evidence in `design.md`.
- [ ] 0.3 Confirm or reject Bits UI as the private headless implementation behind OpenForge components; verify `openspec validate add-angular-extensible-theming --strict` passes after recording the decision, and stop for planning revision before task 1.1 if the spike rejects it.

## 1. Theme contract and registry

- [ ] 1.1 Add failing tests for complete theme-token validation, stable built-in identifiers, explicit appearance, duplicate identifiers, and immutable available-theme snapshots; verify the focused theme contract tests fail for the missing implementation.
- [ ] 1.2 Implement the typed theme definition, fixed semantic token record, angular light and dark built-in definitions, and validation helpers; verify the focused theme contract tests pass.
- [ ] 1.3 Add failing registry tests for built-in registration, contributed registration ownership, selection, unregistering an inactive theme, and atomic fallback when the active theme disappears; verify the focused registry suite fails before implementation.
- [ ] 1.4 Implement the host-owned theme registry with built-in and contributed adapters, reactive available-theme and selected-theme snapshots, generation-aware ownership, and built-in-light fallback; verify the registry suite passes.
- [ ] 1.5 Add failing document-adapter tests for applying the complete `--of-*` token set, separate theme-id and appearance attributes, mounted theme updates, and retention of the current theme after candidate validation failure; verify the focused adapter suite fails first.
- [ ] 1.6 Implement the document theme adapter and connect it only through the registry selection interface; verify document-adapter and registry tests pass together.

## 2. Persistence, startup, and settings

- [ ] 2.1 Add failing tests for migrating stored `light` and `dark` values, restoring a stable theme id, waiting for app-level plugin activation before resolving contributed themes, and persisting a diagnosed built-in-light fallback; verify the focused initialization tests fail first.
- [ ] 2.2 Replace binary theme persistence with stable theme-id persistence and add compatibility migration plus unavailable-theme diagnostics through the existing typed configuration wrapper; verify the initialization and existing `src/lib/theme.test.ts` coverage passes.
- [ ] 2.3 Wire theme initialization into the application readiness sequence after app-level plugin activation while retaining immediate built-in-light document defaults; verify application lifecycle tests prove that the normal shell does not present a stale or partially applied theme.
- [ ] 2.4 Add failing settings tests for listing built-in and contributed themes, identifying plugin ownership, selecting a theme, reflecting external registry changes, and falling back when the selected contribution disappears; verify the focused settings tests fail first.
- [ ] 2.5 Replace the light/dark toggle with a registry-backed theme selector and accessible ownership labels; verify the settings tests and keyboard interaction assertions pass.

## 3. Angular built-in presentation

- [ ] 3.1 Move theme values out of the daisyUI theme declarations, define the documented semantic `--of-*` variables for both built-ins, and map daisyUI color and geometry variables to them; verify a focused CSS contract test finds every required mapping with no token cycles.
- [ ] 3.2 Apply the website-derived neutral canvas, blue accent, crisp borders, compact geometry, technical metadata typography, restrained elevation, status colors, code colors, and independent dark palette; verify automated contrast checks cover primary text, secondary text, controls, focus, and semantic states in both themes.
- [ ] 3.3 Separate theme definitions and adapters from unrelated Markdown, terminal, status, and animation rules currently collected in `src/app.css`; verify the renderer build resolves every stylesheet and the CSS contract tests still pass.
- [ ] 3.4 Add representative light and dark visual fixtures for the shell, settings, modal, task view, and a built-in plugin view; verify the approved screenshots show the angular geometry at normal and reduced desktop widths.
- [ ] 3.5 Verify reduced-motion theme transitions and keyboard focus visibility in both built-in themes through focused browser or Electron checks and record the validation output.

## 4. Theme-sensitive package integration

- [ ] 4.1 Add failing Mermaid theme tests where appearance disagrees with the identifier text, then replace identifier substring inspection with explicit appearance input or the root appearance attribute; verify `packages/plugin-sdk` Mermaid tests pass.
- [ ] 4.2 Add failing PR diff tests for explicit appearance updates, then pass selected appearance into diff workers and mounted viewers without relying on `data-theme` naming; verify `packages/pr-review-ui` and renderer diff tests pass.
- [ ] 4.3 Add failing terminal-runtime tests for a selected presentation snapshot, custom terminal tokens, reactive theme changes, and non-browser fallbacks; verify the focused terminal suites fail first.
- [ ] 4.4 Replace the terminal runtime's duplicate theme mode and palette selection with the host-provided appearance and terminal token snapshot while retaining isolated package fallbacks; verify terminal unit and integration tests pass.
- [ ] 4.5 Wire Markdown previews, Mermaid previews, diffs, and terminal sessions to the selected-theme snapshot and test that a custom dark id without `dark` updates every mounted consumer correctly.

## 5. Trusted Plugin theme contributions

- [ ] 5.1 Add `themes` to plugin capability types, metadata validation, JSON schema, public declarations, and capability documentation; verify package metadata and published-contract tests accept `themes` and reject unknown values as before.
- [ ] 5.2 Add failing frontend interface and testing-fake tests for `openforge.themes.register`, qualified ids, disposable registrations, call recording, duplicate local ids, invalid definitions, missing capability, and project-enabled rejection; verify the focused SDK suites fail first.
- [ ] 5.3 Implement the public registration types, frontend interface, testing fake, and unavailable-host errors with app-enablement and capability checks; verify the focused SDK suites pass.
- [ ] 5.4 Add failing renderer runtime tests for registration qualification, plugin ownership, activation-generation cleanup, disable, uninstall, successful reload replacement, stale reload completion, and failed reload fallback; verify the focused plugin runtime suites fail first.
- [ ] 5.5 Implement runtime theme contribution storage and cleanup through the existing contribution lifecycle modules; verify plugin activation, app-enablement, and reload lifecycle tests pass.
- [ ] 5.6 Add failing stylesheet lifecycle tests for package-relative `plugin://` resolution, inactive loading, atomic activation after all files load, load failure retention of the current theme, theme switch cleanup, and stale generation cleanup; verify the focused loader tests fail first.
- [ ] 5.7 Implement selected-theme stylesheet loading separately from ordinary `frontendStyles`, including inactive preload, atomic commit, error attribution, and cleanup; verify loader and registry integration tests pass.
- [ ] 5.8 Add an integration fixture that registers a contributed theme and verify it appears in settings, applies tokens and selected CSS, persists by qualified id, survives successful reload, and falls back after disable.

## 6. Public OpenForge UI building blocks

- [ ] 6.1 Add the confirmed Bits UI dependency to the plugin SDK and failing package-contract tests for packed external-plugin consumption, host-shared Svelte, and absence of Bits UI types from public OpenForge interfaces; verify the focused dependency and contract tests fail before integration.
- [ ] 6.2 Define the final documented OpenForge interfaces and red behavior tests for icon actions, text fields, selects, text areas, switches, badges, panels, tabs, anchored menus, and tooltips without exposing the headless implementation; verify each focused test starts red before its component exists.
- [ ] 6.3 Migrate existing Button, Checkbox, page, disclosure, and resize components from daisyUI assumptions to native elements with scoped `--of-*` styling without changing their supported interfaces; verify all existing SDK UI tests pass under light, dark, and custom token fixtures.
- [ ] 6.4 Replace Modal's hand-written composite interaction internals with the confirmed headless primitive while preserving its OpenForge interface; verify dialog role, accessible naming, escape handling, overlay dismissal, focus trapping and restoration, controlled state, and portal tests pass.
- [ ] 6.5 Implement token-driven Button, IconButton, TextField, Textarea, Checkbox, and Switch behavior with native attributes, bindable state where appropriate, `on`-prefixed callbacks, validation states, disabled handling, accessible naming, and reduced-motion presentation; verify their focused behavior tests pass.
- [ ] 6.6 Implement Badge and Panel as presentation-only components with semantic variants and caller-owned content; verify tests cover rendered semantics without asserting utility classes or internal markup.
- [ ] 6.7 Implement Select and Tabs with the confirmed headless primitives behind stable OpenForge properties and callbacks; verify controlled selection, keyboard navigation, selected and disabled semantics, focus behavior, portals where applicable, and token-driven presentation tests pass.
- [ ] 6.8 Implement AnchoredMenu and Tooltip with the confirmed headless primitives and no renderer services; verify positioning, dismissal, escape, focus, portal, accessible-name or description, and controlled-state tests pass.
- [ ] 6.9 Add every new component to the canonical public UI export manifest and generated package contracts; verify entrypoint registry, source alias, asset copy, package export, packed external-plugin build, single Svelte runtime, and published-contract checks pass.
- [ ] 6.10 Document each component's import, properties, callbacks, accessibility ownership, variants, theming behavior, and testing guidance without requiring callers to know Bits UI; verify all documented imports resolve against a packed SDK artifact.

## 7. Host and built-in plugin migration

- [ ] 7.1 Add a bounded inventory check for direct covered control classes and fixed geometry in migrated areas, with an explicit allowlist for feature-specific layout and status presentation; verify the check catches a seeded violation without flagging allowed layout.
- [ ] 7.2 Migrate application shell, sidebar, toolbar, and project navigation controls to public building blocks while preserving keyboard shortcuts and navigation behavior; verify shell and navigation suites pass.
- [ ] 7.3 Migrate palette, modal, dialog, anchored menu, and tooltip callers to public building blocks while preserving focus restoration, escape, overlay dismissal, and close confirmation behavior; verify the modal and palette suites pass.
- [ ] 7.4 Migrate global and project settings forms, selectors, toggles, panels, badges, and actions to public building blocks; verify settings autosave, provider, plugin, companion, and accessibility suites pass.
- [ ] 7.5 Migrate task creation, focus board filters, task cards, and shared task controls while preserving draft state, label behavior, filtering, and keyboard interactions; verify create-task and focus-board suites pass.
- [ ] 7.6 Migrate task detail, review, terminal shell, inspector, relationship, and feedback controls while preserving mounted-pane, lifecycle, diff, and completion behavior; verify the task-detail and review suites pass.
- [ ] 7.7 Migrate plugin installation, inventory, lifecycle, diagnostics, and settings controls in the host; verify plugin settings and lifecycle component suites pass.
- [ ] 7.8 Migrate the task-schedules plugin's covered controls and durable panels while retaining feature layout and schedule behavior; verify its package tests and build pass.
- [ ] 7.9 Migrate the GitHub sync plugin's covered controls, forms, tabs, badges, menus, and panels while retaining PR, Jira, review, and walkthrough behavior; verify its package tests and build pass.
- [ ] 7.10 Migrate covered UI in file-viewer, task-browser, terminal, and demo plugins while retaining their feature-specific layout and custom presentation; verify each affected plugin's tests and build pass.
- [ ] 7.11 Run the inventory check across all migrated host and built-in plugin areas and resolve every unapproved direct covered control or fixed-geometry occurrence; verify the inventory reports no violations.

## 8. Documentation and affected-system validation

- [ ] 8.1 Update plugin authoring, capability, SDK reference, styling, and testing documentation with app-level theme registration, token requirements, optional selected stylesheets, Trusted Plugin risks, fallback behavior, and a complete example; verify documentation links and example imports resolve.
- [ ] 8.2 Update plugin package fixtures and authoring-contract examples for the additive `themes` capability and public UI exports; verify package metadata, entrypoint registry, and dry-pack checks pass.
- [ ] 8.3 Run focused affected-package checks with `pnpm packages:test`, `pnpm packages:build`, `pnpm packages:contract:check`, `pnpm packages:metadata:check`, and `pnpm build:plugins`; record commands and resolve all failures.
- [ ] 8.4 Run full renderer static and behavior checks with `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm lint`; record commands and resolve all failures.
- [ ] 8.5 Run the production renderer build with `pnpm build` and any applicable cross-boundary contract checks selected from the final diff; record skipped checks and remaining gaps.
- [ ] 8.6 Exercise the packaged or development Electron app in built-in light, built-in dark, a token-only contributed theme, and a contributed theme with custom CSS; verify selection, restart restoration, reload, disable fallback, terminal, diff, Mermaid, keyboard focus, reduced motion, and recovery from a broken theme.
