# File Viewer presentation migration, KVG-4869

File Viewer colors now use semantic host utilities. The selected-file spinner uses the SDK LoadingIndicator, with the existing polite status as its only announcement. The Storybook module frame also uses semantic paint. File selection, scrolling, syntax highlighting, Markdown rendering, PDF handling, media controls, plugin CSS and SDK exports are unchanged.

`scripts/file-viewer-ui-migration.test.mjs` checks the complete plugin source and executable tests plus `storybook/shared/frames/FileViewerModule.svelte` with the existing inventory parser. The remaining scanner candidates are reviewed domain words, accessibility roles, and one dynamic `language-*` syntax-highlighting class. There are no legacy color, component or unexplained dynamic consumers in this scope. The historical inventory in `docs/ui-migration-consumers.json` is not a current completion count.

## Validation

- `pnpm --filter @openforge-app/plugin-file-viewer test`: 112 passed, 2 skipped. The skips are the existing opt-in PDF browser suite.
- `pnpm --filter @openforge-app/plugin-file-viewer build`: passed. The current package has no separate typecheck script.
- `pnpm exec vitest run scripts/file-viewer-ui-migration.test.mjs scripts/check-ui-migration-inventory.test.mjs scripts/semantic-utilities.test.mjs scripts/storybook-migration-browser-harness.test.mjs scripts/check-host-presentation-inventory.test.mjs --testTimeout=30000`: 40 passed.
- `pnpm test --maxWorkers=4 --reporter=verbose`: 878 files passed, 11 skipped; 7,547 tests passed, 3 expected failures, 43 skipped. Completed in 300 seconds.
- `pnpm check:ui-migration`, `pnpm lint`, `pnpm build`, `pnpm storybook:build`, `pnpm storybook:coverage`: passed. Storybook coverage still lists existing uncovered modules, including PdfPreview. Production host CSS emits the migrated semantic classes; the plugin bundle includes the SDK spinner's scoped styles.
- With pages and components Storybook running, `PAGES_STORYBOOK_URL=http://127.0.0.1:6006 COMPONENTS_STORYBOOK_URL=http://127.0.0.1:6007 node scripts/check-file-viewer-presentation.mjs`: 69 Arc CDP cases passed, including 1280 and 1000 CSS-pixel baselines and a 900px narrow story. The test keeps the File Preview mounted while selecting four built-in themes and two contributed themes. It checks source navigation, return focus, edited search, loading/error announcements, semantic token paint, opacity, bounds within one CSS pixel of the approved loading/error baseline, long-line scrolling and horizontal overflow. It also replaces a contributed palette and checks focus, input, paint, and geometry while mounted. Screenshots and measurements are under ignored `artifacts/file-viewer/presentation/`.
- `node scripts/check-file-viewer-static.mjs`: 12 production-static Storybook checks in Arc passed for all four built-in themes.
- CI visual shard 3 initially failed on the File Loading story: 204 pixels in the SDK loading indicator differed from the old approved image; all other content matched. The pinned CI current image and a local `pnpm storybook:visual:update` capture were byte-identical. Approved only `storybook/baselines/pages/pages-file-viewer--file-loading--openforge-light--1280x800.png`; `pnpm storybook:visual:check` then passed all 419 canonical cases with no other baseline changes.

## Gaps

- Earlier repository-wide attempts timed out under other test-worktree load. The four-worker run above completed successfully; the two Storybook tests that failed in one overloaded attempt also passed individually.
- `node scripts/storybook-file-viewer-check.mjs` scanned the production-static File Viewer stories, then failed at its unscoped `getByRole('separator')` selector because the page has both sidebar and Files separators. KVG-5261 tracks that test fix; the separate production-static checks above passed.
- CI Frontend Shard 2/3 failed once in the unrelated `scripts/restart-workspace-fixture.test.mjs` test: the test reads `restart.json` after the writer exits, racing cleanup that may already remove it. Its focused rerun passed (2/2), as did the earlier full repository suite. KVG-5276 tracks test stabilization outside this File Viewer PR.
- The existing `plugins/file-viewer/src/lib/pdf/renderer.browser.test.ts` suite remains opt-in and skipped in the standard test configuration. PDF behavior was not changed here.
- Migration-wide visual baseline approval and packed SDK publication checks belong to the shared migration/removal Tasks. This slice approves only its File Loading image and keeps SDK contracts unchanged.
