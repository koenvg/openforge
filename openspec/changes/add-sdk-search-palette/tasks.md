## 1. Establish compatibility coverage

- [x] 1.1 Inventory all consumers of the app palette controls and navigation helper, SDK public UI export/declaration conventions, and overlapping theme/Storybook changes; verify a recorded migration map accounts for every affected import without depending on unmerged work.
- [x] 1.2 Add or strengthen host behavior tests for command/task matching and selection, project active selection and attention information, action ordering and confirmation, and each mode's exact footer hints; verify these compatibility tests pass before migration.
- [x] 1.3 Add failing tests against the planned public SDK palette Interface for controlled query/selection, groups, keyboard aliases, pointer activation, loading/empty states, and instance-safe active descendants; verify failures identify the missing palette capability rather than unrelated setup errors.

## 2. Build the shared SDK palette

- [x] 2.1 Implement the generic SDK search palette and necessary private list/input/row/footer Modules without app imports, including viewport-bounded shared layout and optional row content; verify the new SDK result-rendering, query, selection, grouping, and state tests pass.
- [x] 2.2 Reuse or move the required navigation implementation into SDK ownership while preserving any necessary app compatibility import; verify Arrow and Ctrl alias navigation, wrap behavior, scroll-to-selection, single callback dispatch, and affected existing navigation tests pass.
- [x] 2.3 Integrate SDK Modal focus and dismissal with caller-owned alternate content and handled-key overrides; add tests before the behavior change and verify search focus, focus containment/return, alternate-content focus, Escape ownership, and no hidden-result activation in a browser.
- [x] 2.4 Register the public `ui/SearchPalette.svelte` entrypoint, declarations, and packaged dependencies; add a downstream consumption check and verify SDK entrypoint checks, build, and published contract tests resolve the palette without workspace-private imports.

## 3. Add plugin-theme customization

- [x] 3.1 Implement semantic-token defaults, documented palette parts and selected state, and optional palette CSS properties for background, border, selection, radius, shadow, and backdrop filtering; verify real-browser defaults remain readable in existing light/dark themes without changing required theme tokens.
- [x] 3.2 Add a selected-theme stylesheet fixture using the public palette hooks, with solid fallback and supported-browser translucent/blur overrides; verify browser tests show overrides applying to the panel and disappearing when the selected theme changes while a palette is open.

## 4. Migrate host palettes

- [x] 4.1 Migrate command search to the SDK palette while keeping task loading, matching, ordering, stable selection, command execution, badges, and the "open or run" footer with Ctrl+N/P; verify command palette behavior and component tests pass with no duplicate activation.
- [x] 4.2 Migrate project switching while retaining active-project initial selection, query filtering, paths, attention indicators, selection-and-close behavior, and the "select" footer with Ctrl+N/P; verify project switcher tests pass.
- [x] 4.3 Migrate the action palette with its existing groups, shortcuts, default-merge badge, execution callbacks, and "execute" footer with Command+K toggle; verify action palette and app action-palette tests pass.
- [x] 4.4 Connect caller-owned merge confirmation to alternate palette content and preserve the existing confirmation text, buttons, confirm/cancel footer, query/selection on return, and repeat protection; verify confirm runs once and Escape returns to search before dismissing.
- [ ] 4.5 Remove superseded composition and event forwarding from the three migrated dialogs while retaining legacy controls for file quick-open and inline prompt completion, as approved by the owner; verify reference searches, import-boundary checks, and legacy consumer tests pass, reconcile their Storybook coverage, and record the remaining migration in follow-up KVG-4988.

## 5. Document and review the shared appearance

- [x] 5.1 Document the public SDK Interface, caller responsibilities, stable styling hooks, and a plugin-theme stylesheet example with fallback behavior; verify examples use published imports and match the implemented typed props and CSS hooks.
- [ ] 5.2 Add/register component stories for grouped and long results, optional icons/metadata, loading/empty states, and alternate content, plus representative host palette stories; verify both Storybook catalogs build and coverage recognizes the added entries.
- [ ] 5.3 Review approved browser screenshots for all three host palettes in light/dark defaults and the customized theme, including narrow/short viewports; verify shared geometry, inset selection, visible search/footer, readable long content, and no added Actions or AI controls. Record the visual evidence using the repository visual workflow.

## 6. Validate the complete affected systems

- [ ] 6.1 Run full renderer validation with `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm lint`; verify successful results or record exact failures and environmental skips, including browser suites skipped for missing prerequisites.
- [ ] 6.2 Run full SDK validation with `pnpm --filter @openforge-app/plugin-sdk test`, `pnpm --filter @openforge-app/plugin-sdk build`, and `pnpm --filter @openforge-app/plugin-sdk check:contract`; verify public entrypoints, declarations, assets, and downstream palette use pass.
- [ ] 6.3 Run `pnpm storybook:build`, `pnpm storybook:coverage`, and applicable pinned-container `pnpm storybook:visual:check` checks following the current visual guide; verify adopted palette stories and screenshots pass or document exact coverage gaps.
- [ ] 6.4 Review the entire task diff for scope and affected subsystems, confirm no backend/native-transparency or unrelated cleanup changes slipped in, and update task-scoped Handoff Notes; verify notes report actual results, remaining gaps, and the separate KVG-4979 follow-up. Widen validation if the complete diff affects additional systems.
