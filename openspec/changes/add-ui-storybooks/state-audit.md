# Page and component state audit, KVG-5284

## Scope and decision rule

Audit baseline: `3a78e23096cbf05344d45fcf6b5f390cfb285b57`. OpenForge reports KVG-4691 through KVG-4704 done. KVG-5261 and KVG-5264 are also done. These task statuses are context, not acceptance evidence.

This audit covers 4.4–4.6 and 5.1–5.9 only. A checkbox requires the applicable states from `specs/ui-storybooks/spec.md`, the real production module and host, local runtime substitution, rendered assertions, and relevant theme/layout checks. A passing module inventory or a successful happy-path play does not establish missing states. Unsupported prop combinations are not requirements.

Fresh native builds contain 296 page stories and 376 component stories. Strict coverage reports 225 covered, 46 excluded, zero uncovered/errors. The checker proves source/contribution assignment and static IDs, not state completeness. SDK exports are also checked against `packages/plugin-sdk/package.json` and actual component fixture imports; a page-owned inventory entry can still render in the component catalog through a composition.

No production UI, story fixture, baseline, visual manifest, exclusion, or historical screenshot inventory changes are part of this audit. The only executable addition checks existing Task Browser page states in a real browser.

## Checkbox decisions

All twelve audited checkboxes remain unchecked for the source-proven gaps below. The passing checks verify their represented states, not complete page/component state coverage.

| Task | Decision | Evidence and remaining requirement |
| --- | --- | --- |
| 4.4 | Keep unchecked | File Viewer and Terminal browser checks pass, but the full-page/task-pane state matrix has gaps described below. |
| 4.5 | Keep unchecked | Jira settings and task status have stateful plays. PR pages, review detail, and walkthrough lack required non-populated scenarios and the page host shell. |
| 4.6 | Keep unchecked | Schedules pass all 37 page and 34 component stories twice; Task Browser adapter interactions and 24 new both-theme/width page checks pass, as does the unchanged 432-case Linux comparison. Task Browser feedback sending, persistence failure, and unavailable-background states remain absent in the page host. There is no remaining demo plugin to recreate. |
| 5.1 | Keep unchecked | Basic SDK controls have state galleries, but Progress has no component-catalog state family and Alert's info/success/warning variants remain unrepresented. Neutral is rendered through SDK View States. The SDK controls browser check also fails on dialog-to-menu switching. |
| 5.2 | Keep unchecked | Composite checks pass 100 renders and resize/reset assertions, including the real PluginPageShell through SDK View States. Mermaid Diagram Preview has no declared expanded state or open/close/zoom keyboard checks. |
| 5.3 | Keep unchecked | Real diff, thread, overview, media, status, and submission UI exists. Submission and reply busy/error states are not covered by their stories. |
| 5.4 | Keep unchecked | In-memory terminal replay, tabs, inactive, disconnect, stale events, and reset checks exist. Component stories do not cover workspace lookup error or shell restart pending/failure. |
| 5.5 | Keep unchecked | Host chrome browser checks pass 53 stories. Model download completion, failure, and retry remain unrepresented by named story states or plays. |
| 5.6 | Keep unchecked | Settings and creation cover many edited/loading/validation/failure/layout states. Voice Input has only Model Required, not recording, transcription, or disabled states. |
| 5.7 | Keep unchecked | Board, attention, inspector, toolbar, agent, and Self Review states exist. The label editor's open/search/create/remove states have no catalog interactions. |
| 5.8 | Keep unchecked | File Viewer and terminal modules render through local adapters. Task Browser feedback component fixtures cannot hold busy actions or unavailable capture backgrounds. |
| 5.9 | Keep unchecked | Schedule module states use fixed time and the local backend. GitHub review Agent and Ticket Coverage modules still have single passive-state stories. |

### 4.4: File Viewer and Terminal contributions

- `storybook/shared/frames/FileViewerPage.svelte` mounts `FilesView` in `PageFrame`, or `TaskFilesView` in `TaskPaneFrame` inside that shell. `FileViewer.stories.ts` has populated/empty/loading/failure, preview formats, file loading/failure, search and directory failures, narrow/overflow, task populated/empty/loading/unavailable/narrow, and navigation/retry/completion plays.
- `pnpm storybook:file-viewer:check` passes all 59 page/component stories, media readiness, repeated remounts, same-document switches, and panel-width reset. KVG-5261's named Files separator is present; this audit does not modify the checker.
- The task source reads through `api.fs.task` in `plugins/file-viewer/src/lib/workspaceSource.ts`. `TaskUnavailable` deliberately rejects that local directory-read boundary, which is the production failed/unavailable-worktree path. There is no separate workspace-lookup method to require here. The passing File Viewer scan covers this error state; its name alone is neither a new runtime state nor a missing API.
- `Terminal.stories.ts` mounts the production project view in `PageFrame`; its runtime-unavailable story instead renders `PluginErrorBoundary`. The task stories mount the production pane in `TaskPaneFrame`, with ready/loading/missing-workspace/lookup-error/overflow scenarios.
- `pnpm storybook:terminal:check` passes 12 page and 14 component stories twice with clean teardown/storage. `storyTerminalAdapter.ts` owns an in-memory runtime and `storyTerminalTransport.ts` echoes ANSI/input without executing a shell. However, that transport has no failing spawn mode. The page catalog does not hold the supported shell restart pending/failure states, or an empty task-pane replay. `TaskTerminalSurface.svelte` renders a disabled Restarting action and a restart-error alert for the first two states.
- Existing selected File Viewer and terminal snapshots cover both themes and narrow/overflow layouts. They do not prove the missing runtime states. Do not close 4.4 based on the browser scan alone.

### 4.5: GitHub Sync pages and contribution contexts

- `GitHubSyncSettings.stories.ts` and `GitHubSyncTaskStatus.stories.ts` each have seven stories. They assert connected/disconnected settings, held loading, save/test failure, task PR populated/empty/loading/failure, disabled merge, URL validation/linking, and refresh against `githubSyncScenario.ts` local backend handlers. `GitHubSyncContributionFrame.svelte` uses production settings/status frames inside `PageFrame`.
- `PullRequestReview.stories.ts` has exactly five static IDs: `pages-pull-request-review--review-queue`, `--changed-files`, `--repository-filters`, `--project-review-queue`, and `--walkthrough`. Their plays reach the real list, detail diff, repository dialog, project scope, and a ready walkthrough concept.
- `githubSyncPrReviewScenario.ts` always returns populated lists and successful file reads. `PrReviewStoryView.svelte` always installs a token. Thus there is no empty/loading/disconnected/failure PR page or detail fixture. `WalkthroughTab.svelte` also supports loading, load error/retry, absent/generation, and stale states beyond the ready concept story.
- `PrReviewPageFrame.svelte` is a full-height `<main>`, not the application's `PageFrame`/`ApplicationShell`. Global and project PR destinations have not been checked in their normal navigation/sidebar layout.
- Current `plugins/github-sync/src/index.ts` contributes two PR views, Jira settings, and task status. It has no live review-row-action registration. Historical row-action wording does not justify adding an invented contribution or counting infrastructure placeholders.
- The review browser suites verify the five adopted pages and populated nested UI. Their success cannot close missing PR states or host layout.

### 4.6: Task Schedules, Task Browser, and removed demo

- `TaskSchedulesPage.svelte` uses `PageFrame` with the registered schedules navigation entry and the production view. Its 37 page stories cover populated/empty/loading/failure/no-project, 768px narrow and long content, details/history, completed/cancelled schedules, all recurrence choices, edit/pause/filter/sort, loading release/retry, held saves/deletes/runs/cancellation, failures/warnings, discard/reopen, and run conflicts.
- `scheduleScenario.ts` installs the local backend; `taskSchedules.browser.test.ts` runs all 37 page and 34 component stories twice. It verifies fixed `Date.now()`, no external requests/diagnostics, storage reset, and poller disposal on same-document switches.
- `TaskBrowserPage.svelte` mounts `TaskBrowserTab` inside production task navigation and the application shell. Its 12 stories cover populated/empty/loading/failure/disconnected/overflow, navigate/history/reload/DevTools, stop, retry, invalid address, feedback capture/review, and delivery. `taskBrowserStories.test.ts` repeats public adapter interactions and checks attachment disposal, original URL, storage, DevTools reset, and diagnostics.
- These page stories exercise successful capture, review, and delivery only. `TaskBrowserTab.svelte` mounts the production feedback editor/review and awaits `api.tasks.sendFollowUp`. `visualFeedbackEditorState.svelte.ts` holds `busy` during delivery and reports delivery/persistence failures. `VisualFeedbackEditor.svelte` disables actions and shows a sending spinner; `VisualFeedbackReview.svelte` separately warns about unavailable capture backgrounds. The local page scenario cannot hold/reject delivery, reject draft persistence, or select an unavailable artifact. These supported page-host states also keep 4.6 open. The component gaps under 5.8 do not excuse the same omissions from the page contribution.
- `storybook/taskBrowserPages.browser.test.ts` adds the missing resting-state browser checks for the six core scenarios at 900 and 1280px in Light and Dark. It checks visible state text, toolbar clipping before interaction, no host-level horizontal scroll, no external requests/diagnostics, and loading-to-stopped transition. Run it explicitly; its normal root-test invocation is opt-in and otherwise skipped.
- `storyBrowserSurfaceAdapter.ts` wraps the SDK testing fake and renders a local attached document. It does not create an Electron browser or navigate a real site.
- The removed `demo-hello-world` plugin has no current source or discovered contribution. The current inventory/build, not that historical catalog task's title, determines scope.
- Existing canonical cases include both-theme populated schedules/browser pages, schedule narrow/long/history/form/error/dialog layouts, browser empty/failure/disconnect/feedback, and both-theme feedback controls/review with narrow overflow. No historical image-selection counts are rewritten.

### 5.1 and 5.2: SDK controls and composites

- Basic galleries are in `storybook/stories/components/sdk`: Actions, Fields, Selectors, Presentation, Navigation, and Tooltips. They use production controls in settings-sized hosts. Actions cover variants/sizes, native disabled and caller-composed busy content; fields cover selected/mixed/disabled/validation; selectors cover selected/disabled options, open/empty/no matches, bounded 5,000-option results, keyword matching, keyboard selection and dismissal. Presentation covers badge/status variants, panels, file types, and long text. Unsupported badge selection/loading or nonexistent Button loading props are not required.
- Split button, tabs, overlays, markdown, file workspace, and view-state stories cover keyboard actions, locked/open/closed overlays, automatic/manual tabs, links/diagram/code overflow, selected/empty/loading/error trees, retry, section collapse, keyboard/pointer resizing, and persisted-width reset.
- `node scripts/storybook-sdk-check.mjs` passes 100 composite/page-shell renders plus pointer resize, double-click reset, and remount width isolation. This is good interaction evidence for the represented states, not evidence of export completeness.
- `packages/plugin-sdk/package.json` exports Alert and Progress. Their inventory assignments are page-owned, but ownership alone does not establish a missing component. Alert renders through Self Review failure components. The SDK View States Error also mounts `SdkPage` → `PluginViewState` → Alert with its default neutral variant. Review independently observed a finished `sdk-view-states--error` render with a visible neutral alert, report-index error, and Retry action. The remaining gaps are the absent Progress component family and Alert's unrepresented info/success/warning variants. A missing dedicated gallery does not negate the already rendered neutral state. Add the remaining supported states before closing 5.1.
- PluginPageShell is also page-owned in the inventory, but `SdkViewStates.stories.ts` renders `SdkPage` with `framed: false`. That fixture mounts the real shell around content/empty/loading/error/overflow/collapsed bodies. `TaskSchedulesModule.svelte` also renders it through the production workspace. Its component reachability is therefore established, and the dedicated page-shell plays cover retry, first report, and collapse. These source connections establish shell coverage; they do not close the separate preview interaction gap.
- `SdkMarkdown.stories.ts` declares a Diagram with no play. The rendered markdown offers an Expand action, but `MermaidDiagramPreview.svelte` mounts only after that action. The SDK scan does not expand it or exercise zoom, Fit, reset, Escape, and focus return. Add an expanded preview interaction before closing 5.2; the passing unexpanded Diagram scan is not that verification.
- `node storybook/stories/components/sdk/check.mjs` fails in `components-plugin-sdk-tooltips--menu` after the dialog story. It attempts a pointer interaction on the More actions button while `pointer-events: none`. KVG-5332 owns that separate readiness/teardown fix. Do not allowlist the diagnostic or count a partial story scan as a pass.
- The manifest retains both-theme control galleries, constrained fields/selectors/presentation, and selected composite overlay/tree/tab cases. Canonical snapshots can pass with this native same-document failure because canonical contexts are fresh per case.

### 5.3 and 5.4: Review and terminal packages

- Review component stories use real `packages/pr-review-ui` modules. `SelfReviewPanels.stories.ts` covers changed files and diff populated/empty/loading/failure; thread/media/status stories cover a conversation, detached thread, rich markdown diff, image viewer, unavailable video, authored/review PR cards, and file error.
- `PrReviewInlineCommentForm.stories.ts` has one populated shortcut story; `PrReviewOverview.stories.ts` has one populated overview; `ReviewSubmitPanel.stories.ts` has one Ready story. The review browser test submits an approval successfully. It does not hold submission pending, reject it, or check the failure/retry/disabled presentation. `ReviewSubmitPanel.svelte` has those distinct branches. `InlineReplyEditor.svelte` likewise supports `isSubmitting` and `error`, neither held by `ReviewCommentThread.stories.ts`. This is enough to keep 5.3 open despite positive diff/status coverage.
- Terminal component families cover TaskTerminalSurface ready/inactive/empty/overflow/reset/disconnected/stale events, TerminalTabs ready/12-tab overflow, TerminalTabsSurface ready/shortcut hints, and TerminalTaskPaneSurface ready/loading/missing workspace. Local runtime tests and the native terminal scan establish no live PTY and clean reset/disposal.
- `TerminalTaskPaneSurface.svelte` has an error message/retry branch, but its component family lacks lookup error. There is no held/failing spawn fixture for the supported Restarting action and restart-error alert in TaskTerminalSurface. The page Lookup Error story does not make the component catalog complete. Keep 5.4 open.

### 5.5–5.7: Host components

- Host chrome checks cover production shell/sidebar/rail/project selection, collapsed/global/plugin navigation, hidden projects and ordering, headers, shortcut/quit dialogs, toasts, context menus, markdown, and bottom-panel resizing. They repeat 53 stories with diagnostics rejected. Shared frames avoid mounting production `App.svelte` orchestration for these components.
- `HostFeedback.stories.ts` has only Downloading. It holds `download_whisper_model` and asserts 25% progress. `ModelDownloadProgress.svelte` also renders completion and failure with Retry; neither has a named story/interaction. Global Voice settings select the settings section, not those download states. This leaves 5.5 open.
- Project/global settings stories cover sections, inherited/edited values, held loading/saving, configuration/validation/provider/credential failure, disabled actions, narrow and long content. Creation/setup, prompt, modal, image, branch, cancellation, and navigation plays provide further state coverage.
- `VoiceInput.stories.ts` has only `ModelRequired`. The production adapter supports idle/disabled, recording duration/stop, transcribing, transcription completion, and recording/transcription errors. There is no local audio recorder scenario covering those states without microphone access. This leaves 5.6 open.
- Focus Board and Task List Item cover status/attention/dependency/selection/empty states and long labels. Attention pages cover empty/loading/failure, filtering/navigation/collapse and retry. Task inspector/toolbar/agent and Self Review component stories cover the main status, dependency, unread output, changed files, diff, feedback, busy agent, and repository-preview states. Existing page/component layout suites and curated galleries cover both themes and constrained widths.
- `TaskLabelEditor.svelte` is assigned only to `components-task-workspace-inspector--backlog`. That resting story does not open Add label, search suggestions, create/remove labels, or show the disabled no-project edit state. No catalog play asserts those labels/actions. This leaves 5.7 open. Broader production component tests are not substitutes for catalog reachability.

### 5.8 and 5.9: Plugin modules

- File Viewer has 27 component stories using controlled presentation models plus the local filesystem. They cover browser/tree loading/empty/error/search limit/reveal failure, toolbar search, preview, text/media/markdown/large/empty/overflow. End-to-end callbacks live in the page stories, not the component presentation no-op actions. Terminal forwarding modules use the package runtime fixtures already described.
- Task Browser's six component stories exercise available controls, captured feedback, save failure, review/long review, and annotation editing. Its browser layout suite checks actions before interaction at 360/600/1000px and scrollable review at host-sized bounds.
- `TaskBrowserModule.svelte` hard-codes `available={true}` and uses immediate capture/persistence callbacks. It cannot hold the busy/disabled/spinner states in `VisualFeedbackEditor.svelte`. `VisualFeedbackReview.svelte` has a distinct unavailable-background warning when `capture.artifactState !== 'available'`; no component fixture selects it. Save Failure is a different error. Keep 5.8 open rather than conflating these states.
- Schedule components cover workspace failure; list empty/loading/selected/narrow/long; inspector paused/completed/cancelled/history/updating/running/success/warning/failure; composer recurrence/mode/required/cron/date validation/saving/narrow/long; and discard/delete/deleting dialogs. Their fixed-time local backend and repeated browser tests cover the schedule portion of 5.9.
- GitHub PR card/link-form families cover CI status/comment/collapse and empty/validation/failure/linking. However, `PrReviewAgent.stories.ts` selects only Project Required, and `PrReviewTicketCoverage.stories.ts` only Jira Disconnected. Production `AgentTab.svelte` supports loading/availability/terminal errors and an active terminal. `TicketCoveragePanel.svelte` supports connected snapshots, ticket errors, criteria/findings and finding selection. Those states are absent even through the current walkthrough fixture. Keep 5.9 open.

## Reproduction and validation

Run from the repository root. Build before every static-index/browser check. Do not update approved images to make this audit pass.

```sh
pnpm i
pnpm storybook:build
pnpm storybook:typecheck
pnpm storybook:coverage:check
pnpm lint
pnpm storybook:coverage
node storybook/stories/components/sdk/check.mjs
node scripts/storybook-sdk-check.mjs
pnpm storybook:file-viewer:check
pnpm storybook:terminal:check
node scripts/storybook-chrome/check.mjs
RUN_STORYBOOK_APP=1 RUN_STORYBOOK_REVIEW=1 RUN_STORYBOOK_HOST=1 \
RUN_STORYBOOK_PLUGINS=1 RUN_STORYBOOK_SCHEDULES=1 \
RUN_STORYBOOK_CREATION=1 RUN_STORYBOOK_NAVIGATION=1 \
pnpm exec vitest run storybook scripts/storybook-coverage scripts/storybook-visual --maxWorkers=1
RUN_STORYBOOK_TASK_BROWSER=1 pnpm exec vitest run storybook/taskBrowserPages.browser.test.ts --maxWorkers=1
# In another terminal, serve the fresh static catalogs:
# python3 -m http.server 6010 --bind 127.0.0.1 --directory storybook-static
# Use /pages and /components as the respective catalog URLs below.
STORYBOOK_URL=http://127.0.0.1:6010/pages pnpm exec vitest run \
  storybook/stories/pages/FocusBoard.browser.test.ts \
  storybook/stories/pages/SelfReview.browser.test.ts \
  storybook/stories/pages/BranchDivergence.browser.test.ts --maxWorkers=1
STORYBOOK_URL=http://127.0.0.1:6010/components pnpm exec vitest run \
  storybook/stories/components/TaskBrowser.browser.test.ts \
  storybook/stories/components/ProjectSidebarList.browser.test.ts --maxWorkers=1
pnpm storybook:visual:check
```

Native logs are under ignored `artifacts/storybook-visual-runs/kvg-5284/`. Canonical comparison evidence is under ignored `artifacts/storybook-visual/`. The unchanged 432-case manifest SHA-256 is `156296970c02c12053d4ea73c359e49e952738c5ec813b9dcce968cd24e41065`. `visual-coverage-inventory.json` and KVG-5283's hosted parity evidence in `validation.md` remain historical records, not evidence for absent states.

| Gate | Result |
| --- | --- |
| Native page and component builds | Pass, fresh 296/376-story indices. |
| Storybook typecheck, coverage typecheck, root lint | Pass; typecheck and lint rerun after the new browser check. |
| Strict source/contribution coverage | Pass, 225 covered / 46 excluded / zero uncovered or errors. |
| Basic SDK controls browser scan | Fail at tooltip dialog-to-menu switching. KVG-5332; no exception or weakened check added. |
| SDK composite browser scan | Pass, 100 renders, pointer/keyboard resize and width reset. |
| File Viewer / Terminal / host chrome scans | Pass, 59 File Viewer stories; 12 page and 14 component Terminal stories twice; 53 chrome stories twice. |
| Storybook, coverage, and visual infrastructure suites with opt-in application/review/host/plugin/schedule/creation/navigation browsers enabled | Pass, 71 files / 393 tests. Five URL-dependent suites initially skip 25 tests, then run explicitly in the next two checks. |
| Page layout browsers with a served pages URL | Pass, 3 files / 16 tests. |
| Component layout browsers with a served components URL | Pass, 2 files / 9 tests. |
| New Task Browser page matrix | Pass, 24 tests; each asserts the actual selected theme. The first run exposed an ambiguous text locator in the failure case; the final check uses the visible heading rather than ignoring either error message. |
| Canonical Linux visual check | Pass, 432/432 baseline comparisons, zero obsolete baselines; `evidence.json` status passed. |

The canonical run uses the pinned Playwright 1.62.1 Noble image digest recorded in `environment.json`, Chromium `151.0.7922.34`, Linux ARM64, scale 1, en-US/UTC, and the fixed story clock. It records baseline revision `3a78e23096cbf05344d45fcf6b5f390cfb285b57` with `dirty: true`; this is working-tree validation, not clean-commit or new hosted-CI evidence. Approved images, manifest, exclusions, and historical inventory are unchanged. Generated reports remain ignored, not part of the task diff.

Validation scope is the Storybook subsystem and its coverage/visual tools. The new file adds browser assertions, not production behavior or shared test configuration. Unchanged renderer/package/plugin production suites, root renderer build/typecheck, Rust, Electron, mobile, and website checks were not rerun. `storybook:visual:test` repeatability and Linux fault probes were not rerun; this task ran the complete canonical baseline check, not the completion gates 8.3/8.4 owned by KVG-5285.

## Completion review

The single fresh-context read-only review requested changes. Its report is `/tmp/KVG-5284-completion-review.md`. It independently passed the new 24-case browser suite, Task Browser adapter/reset test, Storybook typecheck, lint, and coverage, and inspected the neutral Alert composition and canonical evidence. The broad subsystem scans and Linux comparison were inspected, not rerun by the reviewer.

Parent disposition:
- P1: Reopened 4.6 and recorded feedback sending, delivery/persistence failure, and unavailable-background gaps in the page host. These states remain unimplemented and must be verified before closure.
- P2: Credited the existing neutral Alert composition and removed neutral from the missing-state list.
- P3: Corrected current coverage to 225 covered / 46 excluded / zero uncovered or errors, matching the native log and independent rerun. KVG-4704's historical 223/43 evidence in `tasks.md` remains unchanged.

These corrections affect documentation and checkbox metadata only. No executable file changed after the successful gates. No second review was requested, and this disposition is not a new reviewer approval.

## Follow-up

- KVG-5332 tracks the newly observed SDK tooltip dialog-to-menu interaction failure. Active/completed tasks were checked before creation; no equivalent tooltip readiness task was found.
- KVG-5333 tracks shared clipping measurements for the Task Browser page/component browser suites. This audit keeps those checks focused rather than refactoring their helper boundary.
- KVG-5311 already tracks the hard-coded Spectrum palette override in the legacy SDK badge comparison gallery. No duplicate cleanup task or palette fix is added here.
- Missing catalog states stay visible in the unchecked OpenSpec tasks above. They are not nonvisual exclusions, and sibling Done statuses do not waive them.
