## Context

OpenForge is a Svelte 5 Electron application built with Vite, Tailwind CSS, DaisyUI, shared UI packages, and bundled frontend plugins. The repository contains 229 Svelte files across the host renderer, the Plugin SDK, PR review UI, terminal runtime, and bundled plugins. Some visual modules accept props directly, while others read stores, call typed IPC wrappers, start runtime clients, or expect a frontend plugin API.

The desktop Vite configuration also rewrites Svelte imports to the `plugin://` host runtime. A browser-only catalog cannot reuse that development configuration unchanged. Existing test support provides useful fixture builders, frontend plugin API fakes, and browser-surface fakes, but several host fixtures depend on Vitest module mocking and cannot run directly in Storybook.

The repository already depends on Playwright, Pixelmatch, and PNGJS. The design can use those packages for screenshot capture and comparison rather than adding a hosted visual-testing service. See `proposal.md` for motivation and `specs/ui-storybooks/spec.md` for required behavior.

## Goals / Non-Goals

**Goals:**

- Keep the page and component catalogs independently runnable, buildable, and reviewable.
- Render production source modules with production styling instead of maintaining visual copies.
- Give stateful UI a deterministic local runtime that stories and behavioral tests can both use.
- Make coverage explicit enough that new pages, plugin contributions, and visual modules cannot silently bypass the catalogs.
- Keep approved screenshots in Git and produce baseline, current, and difference images when comparison fails.
- Make the canonical screenshot command reproducible on developer machines and CI.

**Non-Goals:**

- Running the Rust sidecar, Electron main process, a real PTY, GitHub, Jira, or other external services from Storybook.
- Cataloging modules that render no UI, test-only wrappers, or plugin registration shims as components.
- Treating every combination of independent props as a required visual state.
- Refactoring unrelated application architecture. The separate cleanup tasks KVG-4652, KVG-4653, and KVG-4654 own the abstraction work already identified in adjacent UI.
- Publishing either catalog as a public hosted site in this change.

## Decisions

### Use two Storybook configurations with shared infrastructure

Add separate page and component configuration directories under a repository-level `storybook/` directory. Each configuration has its own story globs, navigation hierarchy, development command, static build command, and output directory. A shared directory owns preview decorators, theme selection, Vite aliases, fixture setup, viewport definitions, and common addons.

Both configurations use the Svelte Vite Storybook integration and source aliases equivalent to the renderer and package test configurations. They do not import the desktop-only Vite plugin that emits `plugin://` URLs. This keeps the catalogs separate without duplicating the difficult build configuration.

An alternative was one Storybook with `Pages` and `Components` headings. That is simpler to configure, but it does not meet the requested separation and makes page-level review runs pay for the much larger component catalog.

### Put runtime substitution behind one story environment interface

Create a framework-neutral story fixture module with a small interface that installs a named scenario, exposes its local adapters where interactions need them, resets mutable state, and tears down global resources. Its implementation owns fixture stores, a `window.openforge` desktop adapter, frontend plugin API fakes, in-memory filesystem responses, browser-surface fakes, terminal transport behavior, controlled time, and expected failures.

Use existing production-independent Plugin SDK testing helpers where they already satisfy this interface. Move reusable pure data builders out of Vitest-bound fixture files rather than importing `vi.mock` into Storybook. Existing tests may consume the same builders after extraction, but Storybook does not depend on the Vitest runtime.

The shared preview decorator creates a fresh story environment for each render and destroys it when the story changes. This prevents state leakage between interactive stories and gives tests the same seam used by stories.

An alternative was mocking each imported IPC function separately in each story. That would expose a large shallow interface to every story, duplicate setup, and make stories depend on implementation details.

### Share the production shell without mounting the production composition root

Extract the visual application shell layout from `App.svelte` into a production module that accepts resolved navigation, active content, and dialog slots. `App.svelte` remains the runtime composition root and supplies live controllers and data. Page stories supply deterministic fixture state through the same shell interface.

Page stories render actual page modules inside this shared shell. Bundled plugin views are imported from source and rendered with their normal contribution props and frontend API context inside the matching rail, sidebar, task-pane, settings, row-action, or status host frame. Stories do not activate packaged plugin bundles or the Electron plugin protocol.

Mounting all of `App.svelte` was rejected because its lifecycle starts polling, plugin reconciliation, desktop listeners, and other production orchestration unrelated to page presentation. Building a story-only copy of the shell was also rejected because its layout would drift from production.

### Track coverage with an explicit inventory and naming convention

Add a typed coverage inventory under `storybook/` with three groups:

- Application pages and bundled plugin visual contributions mapped to page story IDs.
- Reusable or visually distinct Svelte source modules mapped to component story IDs.
- Allowed exclusions mapped to non-empty reasons.

A validation script discovers Svelte source files in the host renderer, shared UI packages, and bundled plugins, then compares them with the inventory. It also reads the Storybook static index to verify that every declared story ID exists. New visual modules and plugin contributions therefore require a story or a deliberate non-visual exclusion.

Stories use explicit titles and stable exported names. Renaming files does not silently change screenshot identity. The inventory, not filename heuristics alone, decides whether a module is covered as a page, a component, or an exclusion.

An alternative was requiring a colocated story for every `.svelte` file. That would force meaningless stories for providers and shims, and it would not prove that plugin contributions appear in the correct host context.

### Model relevant states instead of a Cartesian product

Each covered visual module declares the states that materially change its appearance or interaction. The common vocabulary is default, populated, empty, loading, error, selected, disabled, attention, narrow layout, and overflow. A module only needs the states it supports. Stateful transitions use Storybook interaction functions against the local story environment.

Page stories use coherent named scenarios such as an empty project, active work, attention requiring action, disconnected integration, and long content. This gives design work realistic screens while avoiding impossible combinations assembled from unrelated knobs.

### Use a manifest-driven Playwright screenshot runner

Add a visual manifest that selects the page and component stories included in snapshots, along with viewport, theme, readiness condition, optional interaction, clip target, and any justified comparison tolerance. The runner builds or serves both static catalogs, resolves each stable story ID through the Storybook index, waits for fonts and story readiness, disables motion, captures PNG files, and compares them with Pixelmatch.

Approved baseline images live under catalog-specific repository directories with names derived from story ID, viewport, and theme. Generated current and difference images live under ignored artifact directories. A failed run writes an HTML or Markdown report linking the baseline, current, and difference files. CI uploads that report and its images so reviewers can inspect the before and after. An explicit update command replaces only baselines selected by the current manifest and reports stale baselines.

Storybook-hosted visual services were rejected because the user asked for screenshots in the repository and the project already has the required local screenshot dependencies.

### Define one canonical screenshot environment

Canonical baselines are captured with the Playwright Chromium version locked by the workspace inside a pinned Linux Playwright container. The local snapshot check and update commands invoke the same container entrypoint used by CI. The capture setup fixes viewport, device scale, locale, timezone, color scheme, reduced motion, local font loading, animation state, and application time.

The ordinary Storybook development commands remain native and fast. Only canonical screenshot generation uses the container. This avoids maintaining operating-system-specific baselines and prevents macOS and Linux font rasterization differences from creating review noise.

Comparison is exact by default. A story may declare a small tolerance only with a recorded reason in the visual manifest. Timeout, console error, missing readiness, missing story, and duplicate or stale baseline conditions fail the run rather than updating screenshots.

### Integrate validation at the workspace level

Add root commands for starting each catalog, building each catalog, validating coverage, checking snapshots, and intentionally updating snapshots. The affected-system CI path installs the pinned Playwright browser or uses the canonical image, builds both static catalogs, validates the coverage inventory, and runs the snapshot matrix.

Unit tests cover inventory validation, fixture reset behavior, adapter responses, story identity, stale baseline detection, and report generation. A small smoke set verifies that each catalog can render one host page, one plugin page, one shared component, and one interactive failure state before broad story creation proceeds.

## Risks / Trade-offs

- [The initial catalog is large] -> Build shared infrastructure and smoke stories first, then add coverage in subsystem-sized batches while keeping the inventory validator disabled only until its final activation task.
- [Page stories may drift from production orchestration] -> Share the production shell layout and source page modules; fake only runtime dependencies and assert fixture contracts separately.
- [Screenshot baselines increase repository size] -> Capture only declared design-significant states, compress PNG files, and reject stale baselines. Do not snapshot every prop combination.
- [Containerized snapshot updates are slower than native capture] -> Keep native Storybook development outside the container and reserve canonical capture for checks and intentional updates.
- [Asynchronous UI can produce flaky images] -> Require explicit readiness, controlled time, loaded fonts, disabled motion, deterministic adapters, and failure on undeclared console errors.
- [Plugin UI may rely on capabilities not yet represented by a fake] -> Add the missing behavior to the shared story environment behind its existing interface instead of adding per-story mocks.
- [Extracting the shared application shell can change production layout] -> Characterize existing shell behavior first and verify production and story hosts through focused renderer tests.

## Migration Plan

1. Add the Storybook dependency set, shared configuration, and independent empty catalog commands.
2. Add the story environment and tests, using existing SDK testing adapters and extracted pure fixture builders.
3. Extract the shared production shell layout and prove that `App.svelte` retains current behavior.
4. Add smoke stories and static-build checks for both catalogs.
5. Add page stories for host destinations, then bundled plugin contributions.
6. Add component stories in batches for the Plugin SDK, shared packages, host renderer, and bundled plugins.
7. Complete the coverage inventory and enable missing-coverage validation.
8. Add the canonical screenshot container, visual manifest, baseline capture, comparison report, stale-baseline checks, and initial repository baselines.
9. Add CI integration and developer documentation, then run full affected-system validation.

Rollback removes the Storybook configurations, stories, fixture module, snapshot tooling, baselines, and workspace commands. The extracted shell can either remain as a production-only module or be reverted with its characterization tests; no persisted user data or public Plugin SDK migration is involved.
