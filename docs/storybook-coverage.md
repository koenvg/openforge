# Find missing Storybook coverage

Run from the repository root:

```sh
pnpm storybook:build
pnpm storybook:coverage
pnpm storybook:coverage:test
pnpm storybook:coverage:check
```

The coverage command reads both `storybook-static/pages/index.json` and `storybook-static/components/index.json`. Rebuild after changing stories; the checker does not build or determine whether an existing build is fresh. It fails for invalid inventory entries, duplicate assignments, invalid exclusions, missing indexes, and missing or renamed story IDs. Diagnostics identify the catalog, production source or plugin contribution, and story ID. Docs entries do not count as stories.

Coverage is currently incremental. A successful command means the adopted entries are valid, **not that the repository has complete story coverage**. Every unassigned item prints an `UNCOVERED` line. `pnpm storybook:coverage --json` returns the complete report for tooling. Use `pnpm --silent storybook:coverage --json` when redirecting output to a JSON file.

KVG-4704, the final catalog delivery ticket, owns enabling full-repository enforcement. `pnpm storybook:coverage --enforce-complete` previews that gate now and fails while any item remains uncovered. Do not enable it in the default root command or CI during incremental adoption.

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

The initial inventory adopts Application Shell, Focus Board, Task Detail, Self Review, and the SDK Button, including their existing declared states. It deliberately adds no exclusions. The initial report contains 243 uncovered items: 232 Svelte modules and 11 visual plugin contributions. Discovery, not these counts, is authoritative as the repository changes.

Catalog-ready fixtures, story-environment fixtures, and placeholder host-frame examples are infrastructure, not proof of production plugin coverage. The real Focus Board host-frame story is included in its page assignment. Subsystem catalog tickets own the remaining production stories; KVG-4704 completes inventory adoption and enforcement.

See [the visual review guide](storybook-visuals.md) for screenshot checks and baseline review. Coverage validation does not approve or update screenshots.
