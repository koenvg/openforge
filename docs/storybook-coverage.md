# Find missing Storybook coverage

Run from the repository root:

```sh
pnpm storybook:build
pnpm storybook:coverage
pnpm storybook:coverage:test
pnpm storybook:coverage:check
```

`storybook:coverage` requires zero uncovered visual modules and contributions. It reads both built `index.json` files and fails for missing or renamed story IDs, duplicate assignments, invalid exclusions, and unclassified sources. Rebuild after editing stories; the checker does not build or check whether an old build is fresh. Diagnostics name the catalog and production source or plugin contribution. Docs entries do not count. `pnpm --silent storybook:coverage --json` prints the complete report for tooling.

`storybook:coverage` is fail-closed: every discovered visual module and plugin contribution needs a real catalog story or a verified nonvisual/test-only exclusion. Keep both catalogs freshly built before checking.

## Develop and build either catalog

Run one development server at a time or both on separate ports:

```sh
pnpm storybook:pages
pnpm storybook:components
pnpm storybook:build:pages
pnpm storybook:build:components
```

The pages catalog runs on port 6006, the components catalog on 6007. Their static indexes and assets live in separate `storybook-static/pages` and `storybook-static/components` directories. `pnpm storybook:build` builds both before coverage validation. The root scripts are the supported entry points; builds do not need Electron, a backend, or a live plugin service.

Put page destinations and visual plugin registrations in `storybook/stories/pages`. Put standalone controls and reusable visual parts in `storybook/stories/components`. Use production components inside the shared host frames, not lookalike markup. A story owns a named resting state with controlled time and local adapters: populated, empty, loading, failure, disabled, narrow, and overflow where they change behavior or layout. State changes belong in story args or `parameters.openforge` and `play` interactions; do not mutate shared stores without resetting them. `storybook/shared/storyEnvironmentPreview` installs a fresh scenario for each render and tears it down on exit. See the subsystem story guides for their fixtures and interaction commands.

The `pages` and `components` arrays in `storybook/coverage-inventory.mjs` assign each production `.svelte` module once, with real IDs from its built catalog. A separate `pages` entry owns each visual bundled-plugin registration. Source discovery also includes test wrappers, which need a justified `test-only-wrapper` exclusion rather than silent filtering. `nonvisual-provider` and `registration-shim` exclusions are allowed only when the parser proves they render no independent UI; visual contributions cannot be excluded. The checker also rejects a test-only wrapper referenced by production. When a module has no actual story, keep it uncovered and make the check fail rather than attaching an unrelated ID.

## Add an inventory entry

Edit `storybook/coverage-inventory.mjs`. Its JSDoc type references `storybook/coverage-types.ts`; `pnpm storybook:coverage:check` checks the inventory and checker together.

1. Add stories using production source modules, with explicit titles and stable exported story names. Use the page catalog for destinations and visual plugin contributions; use the component catalog for reusable or visually distinct controls.
2. Build both catalogs and copy the actual story IDs from the appropriate `index.json`. Do not infer IDs from source filenames or import stories into the inventory. Keep IDs explicit so a story rename fails validation until the inventory is updated deliberately.
3. Add one assignment for the production module under `pages` or `components`, listing its adopted story states. Never assign the same module twice, across catalogs, or both as covered and excluded.
4. For a plugin, also add an assignment for each visual contribution under `pages`. Use the registration source and the identity printed by discovery. A contribution and its component module are separate items. Multiple contributions can share a component without covering each other's host contexts.
5. Run the commands above. Review the uncovered remainder rather than turning it into exclusions.

Example entries, with illustrative future story IDs that must exist before adoption:

```js
pages: [
  {
    source: 'plugins/file-viewer/src/FilesView.svelte',
    stories: ['pages-file-viewer--populated', 'pages-file-viewer--empty'],
  },
  {
    source: 'plugins/file-viewer/src/index.ts',
    contribution: 'com.openforge.file-viewer:views.register:files',
    stories: ['pages-file-viewer--populated', 'pages-file-viewer--empty'],
  },
],
components: [
  {
    source: 'packages/plugin-sdk/src/ui/Button.svelte',
    stories: ['components-button--primary'],
  },
],
```

Sharing a story ID between distinct targets is allowed when that story actually renders both. Repeating an ID within an entry is an error. Reviewers must verify that the named story renders the claimed production UI and relevant states. Index validation proves identity and catalog membership, not render fidelity or state completeness.

## Discovery scope

The checker scans `src`, `packages/*/src`, and `plugins/*/src`. It discovers every `.svelte` module, including test wrappers so they cannot vanish without a recorded decision. It skips generated and dependency directories and does not follow symlinks. Storybook-only frames, external dependencies, and separate `apps/*` applications are outside this desktop catalog.

Plugin IDs come from `plugins/*/package.json` metadata. The checker parses JavaScript, TypeScript and Svelte scripts without executing activation. It recognizes `views.register`, `taskPane.registerTab`, `taskUI.registerTab`, `taskUI.registerSection`, `settings.registerSection`, `reviewUI.registerRowAction`, `injectionPoints.register`, and `viewReplacements.register`, including local registry aliases. Nonvisual command registrations are not contributions.

Contribution identities use `plugin ID:registry.method:local ID`, so a tab and a page may have the same local ID. Duplicate identities fail even when declared in different source files. Registration objects must declare one literal, non-empty `id` without spreads. Dynamic registration factories or IDs fail with a source diagnostic instead of silently disappearing. Keep declarations statically discoverable; extend the parser and its public discovery tests when adding a new registry or declaration pattern.

## Exclusions

Only these categories are allowed, each with a non-empty, reviewable `reason`:

- `nonvisual-provider`: supplies context or lifecycle state without independently visible UI.
- `registration-shim`: registers behavior and has no independently visible UI.
- `test-only-wrapper`: exists only to mount UI in tests.

For providers and shims, the checker inspects the Svelte template. It permits forwarding the caller's `children` snippet and follows relative Svelte imports to verify nonvisual child modules. HTML, visible child components, dynamic markup, and unresolved component references prevent exclusion. A test wrapper must follow the repository test naming conventions and have no production references, including through other test-named files. That reference check is conservative: ambiguous text references keep a wrapper uncovered for review.

Visual contributions cannot be excluded. Neither complexity, missing adapters, pending tickets, nor lack of time justifies a nonvisual exclusion. Leave those items uncovered.

## Foundation adoption

The foundation originally adopted Application Shell, Focus Board, Task Detail, Self Review, and the SDK Button. Its historical report had 243 uncovered items. Discovery and the current strict check, not that count, are authoritative.

Catalog-ready fixtures, story-environment fixtures, and placeholder host-frame examples are infrastructure, not proof of production plugin coverage. The real Focus Board host-frame story counts for its page assignment. Missing production UI remains visible in the strict coverage report until a real story is added.

`infrastructure-host-frames--plugin-page` is the foundation exception: it mounts File Viewer's exported `FilesViewComponent` in `PageFrame` with the plugin API and context, reads a local directory fixture, and opens a file into its preview. Its play check verifies both the visible contents and the filesystem API requests. The scenario resets the plugin's file-selection stores between renders. Task pane, settings, row-action, and status examples remain explicitly named layout placeholders and have no production contribution assignments.

KVG-4697 supplies the full File Viewer catalog and inventory entries described below. The foundation smoke remains a host-integration check rather than duplicating that state matrix. KVG-4698 owns Terminal. KVG-4702 completes the live Task Browser contribution in the [Task Browser catalog](storybook-task-browser.md); the removed demo plugin has no production contribution to recreate. This smoke does not complete those subsystem catalogs.

## File Viewer catalog

File Viewer owns its page and Task-pane contributions plus its six visible child modules. Shared SDK controls remain owned by the SDK catalog. Stories use the production components and host frames with an in-memory plugin filesystem; no workspace files are opened or changed.

After building both catalogs, run `pnpm storybook:file-viewer:check` to check every File Viewer story in Chromium, including play interactions, video metadata, repeated remounts, and same-document story switching. Unexpected console diagnostics and external requests fail the check. Evidence goes to `artifacts/file-viewer/browser`. These native checks do not replace the canonical screenshot commands.

Fixture edits, selections, pending operations, and saved panel widths reset through the shared story environment. `storybook/shared/fileViewerStories.test.ts` exercises the same lifecycle through portable stories, including fixture edits through the plugin API.

See [the visual review guide](storybook-visuals.md) for screenshot checks and baseline review. Coverage validation does not approve or update screenshots.
