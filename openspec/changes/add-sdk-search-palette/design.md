## Context

See `proposal.md` for motivation and `specs/sdk-search-palette/spec.md` for the behavior contract. This design is required because the change crosses the app/SDK interface, public package exports, and theme styling.

The app's `PaletteInput`, `PaletteListbox`, and `PaletteFooter` already share presentation and some interaction. `PaletteListbox` depends on app-local `useListNavigation`. `PaletteModal` wraps SDK `Modal` at 520px with top positioning, while `ProjectSwitcherModal` uses SDK `Modal` directly at 480px. Command search and action search track selection by identity; project switching has a distinct active-project initial selection policy. Action search replaces its body with merge confirmation.

The SDK theme definition already accepts selected-theme `stylesheets` alongside a required set of semantic tokens. New palette defaults can use these tokens directly, and theme stylesheets can override documented palette hooks. No theme registry or native window changes are needed.

## Goals / Non-Goals

**Goals:**
- Put layout, option semantics, navigation, scrolling, and modal integration behind one SDK Module with a small Interface.
- Keep domain decisions in host Adapters, including query matching, result ordering, attention indicators, command execution, and confirmation state.
- Give plugin themes a supported styling Interface without requiring themes to know generated Svelte classes or app selectors.

**Non-Goals:**
- A new search engine, fuzzy ranking, recent-items system, command registry, or actions submenu.
- Raycast's AI controls, branding, exact light colors, or native desktop vibrancy.
- General-purpose navigation refactoring outside dependencies required by the SDK extraction.
- Task-loading error recovery, tracked separately as KVG-4979.
- Implementing the other active theme, daisyUI-removal, or Storybook changes.

## Decisions

### 1. Publish one integrated search palette

Expose `@openforge-app/plugin-sdk/ui/SearchPalette.svelte`. Internally compose SDK Modal, search input, result-list navigation, rows, and footer. Keep supporting Modules private unless an existing public contract requires otherwise. This creates a real Seam shared by three host Adapters and downstream plugins.

The typed Interface accepts generic items and stable keys, controlled query and selected index with `on`-prefixed change callbacks, selection/dismissal callbacks, accessible names, optional grouping, loading/empty content, and footer information. Provide constrained row snippets for leading content, main label/description, and trailing metadata rather than making every caller rebuild row geometry. The palette owns combobox/listbox wiring, option identifiers, scroll-into-view, modal focus, and single-dispatch key handling.

Do not move host filtering or identity policies into the SDK. A caller computes selected index from its own stable identity; the SDK validates that index before exposing or activating an option. Preserve the current wrap navigation and Ctrl aliases. Do not expose an imperative listbox handle merely to make callers forward keyboard events.

Alternative: export the four existing controls and require callers to assemble them. Rejected because it preserves repeated keyboard and modal wiring and permits layout drift. Alternative: a host-aware SDK that reads stores and executes commands. Rejected because plugins must consume it without app-private dependencies.

### 2. Support caller-owned alternate content without another modal

Provide an optional alternate-body snippet with an associated initial-focus target and keyboard override callback. It replaces search/results inside the same dialog while retaining the shared footer. A handled event must stop normal palette handling. Hidden search results have no active descendant and cannot receive Enter activation.

The action palette retains its pending-confirmation state and buttons. It supplies existing confirmation content, focus target, and confirm/cancel footer information. Escape cancels confirmation and restores search focus; a later Escape dismisses the palette. The SDK does not know what a merge is.

Alternative: mount a second confirmation dialog or recreate the palette on every mode switch. Rejected because focus restoration, Escape ownership, and retained query/selection become harder to preserve.

### 3. Share geometry and use existing semantic tokens

Use one default width, initially 640px bounded by viewport gutters, for all three palettes. This is a design assumption, not a pixel-exact copy of the reference. Keep the current upper-viewport presentation for search palettes and apply it consistently to project switching. Bound the complete dialog height to the viewport; only the result area scrolls. Long descriptions can truncate inside their own flexible column rather than pushing trailing metadata off-screen.

Use theme spacing and text sizes for a larger search field, sentence-case group headings, compact rows with an inset selection background, and a separated footer. Keep icons optional. Preserve existing badges and status information without inventing new domain icon mappings. Use semantic `--of-*` properties rather than introducing daisyUI dependencies or hardcoded Raycast colors.

Alternative: preserve separate 480px and 520px layout rules. Rejected because consistent geometry is part of the requested shared experience. Precise spacing can be tuned in stories without changing behavior or public interfaces.

### 4. Document component-local theme properties and stable parts

Expose a stable root marker such as `data-of-search-palette` and named parts for panel, input, list, group heading, option, and footer. Expose selection state on options. Keep the supported parts independent of private DOM nesting.

Document optional CSS properties on the palette root, with semantic-token fallbacks: `--of-palette-background`, `--of-palette-border`, `--of-palette-selection`, `--of-palette-radius`, `--of-palette-shadow`, and `--of-palette-backdrop-filter`. Use the background and filter on the panel itself, not an opaque child that masks theme transparency. Default backdrop filter is `none`; the default background uses the existing theme surface. Text, focus, and other geometry continue to use semantic tokens and named parts.

These are optional component CSS properties, not additions to the required `ThemeTokens` manifest contract. Existing theme-scoped stylesheet loading supplies overrides and removes them on theme switch. Document a theme example with a solid fallback and an `@supports` translucent/blur override. Blur applies to app content behind the panel, not the operating-system desktop. Do not add a new production theme as part of this task; a test fixture and documented example demonstrate support.

Alternative: add mandatory palette tokens to every theme definition. Rejected as a breaking expansion when optional properties and existing stylesheets suffice. Alternative: theme authors target app classes or replace the palette. Rejected because it couples them to implementation details.

### 5. Extract navigation only as far as necessary

Trace all callers of the existing palette controls and `useListNavigation` before moving dependencies. The SDK implementation must not import from app `src/`. Move reusable navigation ownership into the SDK or reuse an equivalent existing SDK helper after comparing behavior. If other app controls still need the existing app import path, retain a thin compatibility re-export rather than copy the algorithm. Do not change those controls' behavior.

The owner approved retaining the app-local palette controls for file quick-open and inline prompt completion. KVG-4988 owns their later migration and removal, including an SDK listbox suitable for inline completion. This change removes composition and event forwarding only from its three migrated host dialogs. Keep legacy controls and their tests intact, and retain accurate Storybook coverage for them alongside the new SDK palette.

### 6. Test through the public Interface and host workflows

Use behavior-first tests for SDK navigation, callbacks, loading/empty states, identifier isolation, focus, and alternate content. Host regression tests protect each caller's filtering, selection policies, result information, footer text, and execution. Published-package tests must import the new entrypoint and its declarations using packaged assets, not workspace-only source resolution.

Use real Chromium checks for focus and theme stylesheet application/removal, plus stories and approved screenshots for visual layout. Do not write unit tests that merely freeze class strings. Cover light and dark defaults, a theme override fixture, long/grouped results, constrained viewport, empty/loading, and confirmation. Follow repository story and visual registration conventions.

## Risks / Trade-offs

- Moving keyboard handling can double-dispatch Enter or mishandle Escape. Mitigation: test at the dialog Interface, including confirmation and repeat protection, and remove old forwarding once migrated.
- Theme CSS can be overridden by scoped component styles. Mitigation: consume documented CSS properties and verify the selected-theme stylesheet path in a browser, including switching while open.
- A single width changes project-switcher positioning and density. Mitigation: review all three palettes side by side and verify constrained viewport bounds rather than cloning screenshot dimensions.
- Private SDK assets or missing declarations can pass workspace tests but fail in plugins. Mitigation: run the published contract checks with a downstream palette import.
- Navigation extraction may touch other controls. Mitigation: inventory callers first, preserve compatibility imports when needed, and widen affected-system validation if the final diff reaches additional packages.
- Existing parallel changes overlap exports, theme styles, and stories. Mitigation: inspect their current state before implementation and keep this change additive without depending on unmerged artifacts.

## Migration Plan

1. Add failing public SDK behavior and host compatibility tests before production edits.
2. Build and publish the SDK palette within the workspace, including declarations, assets, and theme hooks.
3. Migrate command search, project switching, and action search, preserving alternate confirmation content and exact footer labels.
4. Remove old composition and event forwarding from the three migrated dialogs. Retain legacy controls and navigation compatibility imports for file quick-open and prompt completion; verify their behavior remains unchanged and record the deferred migration in KVG-4988.
5. Add documentation and visual examples, then run full affected-system validation for renderer and SDK because the work changes a shared public Interface and focus lifecycle. Use `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, SDK `test`, `build`, and `check:contract`, plus applicable Storybook coverage and visual checks. Re-evaluate commands against the complete diff and the current testing guide at implementation time.
6. Roll back by reverting the host migration and SDK addition together before release. No persisted data or backend migration is involved. Once published, treat the SDK entrypoint and documented styling hooks as public contracts rather than removing them in a later patch.
