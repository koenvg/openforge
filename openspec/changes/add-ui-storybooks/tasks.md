## 1. Catalog foundations

- [x] 1.1 Add the compatible Svelte Storybook dependency set and root scripts for independent page and component development servers, then verify `pnpm install --frozen-lockfile` succeeds and each help/start command resolves its own configuration.
- [x] 1.2 Create the two Storybook configuration directories and shared configuration factory, then verify each empty catalog produces a distinct static output with its dedicated build command.
- [x] 1.3 Add shared renderer aliases, production CSS and font loading, theme selection, viewport definitions, and motion controls, then verify a theme fixture renders with resolved OpenForge tokens in both catalogs.

## 2. Deterministic story environment

- [x] 2.1 Write failing lifecycle tests for fresh scenario installation, reset between renders, controlled time, and teardown, then implement the framework-neutral story environment until those tests pass.
- [x] 2.2 Write failing adapter tests for desktop commands and events, local configuration, filesystem reads, and declared failures, then implement those local adapters and verify the tests pass without Electron or the sidecar.
- [x] 2.3 Write failing adapter tests for frontend plugin capabilities, browser surfaces, and terminal behavior, then integrate the existing SDK testing fakes and add any missing local adapters until the tests pass without external services.
- [x] 2.4 Extract reusable task, project, review, schedule, file, and settings builders from Vitest-bound fixtures, update existing tests to consume the pure builders, and verify the affected renderer and plugin tests pass.
- [x] 2.5 Add the shared preview decorator that creates and destroys one story environment per render, then verify an interaction smoke test can mutate a story and a rerender starts from the original fixture state.

## 3. Shared application shell

- [x] 3.1 Add characterization tests for the current application shell layout, active content selection, navigation chrome, collapsed sidebar, zen mode, and dialog slots, then verify the new tests pass against the existing `App.svelte` behavior.
- [x] 3.2 Extract the visual shell layout behind a small production interface used by `App.svelte` and page stories, then verify the characterization tests and focused `App.svelte` tests pass unchanged.
- [x] 3.3 Add page-host frames for full-page, task-pane, settings, row-action, and status contributions, then verify smoke stories render one host page and one bundled-plugin contribution with production layout and no desktop bridge.

## 4. Page Storybook coverage

- [x] 4.1 Add Focus Board page stories for populated, empty, loading, failure, attention, filtered, narrow, and overflow scenarios, then verify the page catalog build renders every declared story without console errors.
- [x] 4.2 Add Task Detail and Self Review page stories for backlog, active, waiting, failed, completed, dependency, terminal, review, and long-content scenarios, then verify their interaction checks reach the declared states using local adapters. Include the approved Self Review disposal guard and mount/unmount regression test.
- [ ] 4.3 Add project settings, global settings, project setup, project switching, command/action palettes, file quick-open, attention overview, and application dialog stories in their production host frames, then verify the page catalog build and declared interactions pass.
- [ ] 4.4 Add File Viewer and Terminal plugin stories for their full-page and task-pane contributions, including empty, populated, loading, failure, and unavailable-runtime states, then verify they render without real filesystem or PTY access.
- [ ] 4.5 Add GitHub Sync plugin stories for pull-request pages, review detail, walkthrough, Jira settings, row actions, and task status contributions, then verify populated, empty, loading, disconnected, and failure scenarios render without network access.
- [ ] 4.6 Add Task Schedules, Task Browser, and demo plugin stories for every visual contribution and relevant state, then verify schedules use the local backend adapter and browser stories use the testing browser-surface adapter.

## 5. Component Storybook coverage

- [ ] 5.1 Add stories for every exported Plugin SDK control and its applicable default, selected, disabled, loading, error, narrow, and overflow states, then verify all SDK UI exports are represented in the component catalog.
- [ ] 5.2 Add stories for the Plugin SDK composite modules such as modal, menus, tabs, tooltip, markdown, file tree, resizable panels, page shells, and view states, then verify keyboard and open/close interaction checks pass.
- [ ] 5.3 Add stories for every visually distinct PR review package module, then verify diff, comment, submission, status, empty, loading, and failure states render in the component catalog.
- [ ] 5.4 Add stories for every visually distinct terminal runtime module using deterministic terminal fixtures, then verify shell, tab, inactive, disconnected, and error states render without a live PTY.
- [ ] 5.5 Add stories for host shared UI, feedback, project, and shell modules, then verify each relevant interaction and layout state renders without importing production application orchestration.
- [ ] 5.6 Add stories for host settings, prompt, create-task, and modal modules, then verify default, edited, disabled, loading, validation, failure, narrow, and overflow states where applicable.
- [ ] 5.7 Add stories for host focus-board, attention, task-detail, and review modules, then verify status, selection, dependency, attention, empty, loading, and failure states where applicable.
- [ ] 5.8 Add stories for visually distinct File Viewer, Terminal, Task Browser, and demo plugin modules not already covered as page stories, then verify their component stories render with local adapters.
- [ ] 5.9 Add stories for visually distinct GitHub Sync and Task Schedules plugin modules not already covered as page stories, then verify their component stories render with deterministic data and controlled time.

## 6. Coverage enforcement

- [ ] 6.1 Write failing tests for source discovery, page and component inventory entries, duplicate assignments, and non-empty exclusion reasons, then implement the typed coverage inventory validator until the tests pass.
- [ ] 6.2 Add failing tests for missing and renamed Storybook IDs, then validate inventory entries against each static Storybook index and verify diagnostics identify the catalog, source path, and missing story ID.
- [ ] 6.3 Populate the inventory for all host, package, and bundled-plugin Svelte files and visual contributions, record only allowed non-visual exclusions, then verify `pnpm storybook:coverage` passes with no unclassified source modules or contributions.

## 7. Repository visual snapshots

- [ ] 7.1 Write failing tests for visual manifest validation, stable image naming, duplicate cases, readiness timeouts, and stale baseline detection, then implement the manifest loader until the tests pass.
- [ ] 7.2 Write failing tests for PNG comparison and report generation, then implement the Playwright capture and Pixelmatch comparison runner so failures retain baseline, current, and difference images under stable identifiers.
- [ ] 7.3 Add the pinned Linux Playwright container entrypoint and root snapshot check/update commands, then verify the same smoke snapshot has identical output on a developer machine through the container and in the CI command.
- [ ] 7.4 Define the design-significant page snapshot matrix across themes and viewports, capture the initial approved page baselines into the repository, and verify the check command passes without modifying tracked files.
- [ ] 7.5 Define the design-significant component snapshot matrix, capture the initial approved component baselines into the repository, and verify the check command passes without modifying tracked files.
- [ ] 7.6 Intentionally alter one disposable fixture during a test, verify the runner fails with a reviewable before/current/difference report, restore the fixture, and verify stale, missing, and unexpected baselines also fail with actionable diagnostics.

## 8. CI, documentation, and completion

- [ ] 8.1 Add affected-UI CI jobs for coverage validation, both static Storybook builds, and the canonical visual snapshot check, including uploaded comparison artifacts on failure, then verify the workflow configuration and local equivalent commands succeed.
- [ ] 8.2 Document page and component development, story state conventions, coverage exclusions, native preview, canonical snapshot checking, intentional baseline updates, and review artifacts, then verify every documented command matches a root package script.
- [ ] 8.3 Run all focused story infrastructure tests, affected renderer and plugin tests, root lint, both static builds, coverage validation, and canonical snapshots; record any skipped subsystem check and verify the working tree contains no generated current or difference artifacts.
- [ ] 8.4 Run the full affected-system validation required by `CONTRIBUTING.md`, perform the required fresh-context code review, resolve or report every finding, and verify the final checked-in baselines match the completed story manifest.
