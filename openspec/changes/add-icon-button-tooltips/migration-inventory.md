# Icon-button tooltip migration inventory

Defaults are top/center/6px with collision adjustment. Existing IconButton sites inherit the SDK behavior; they do not need wrappers. Entries remain pending until their consumer regressions and duplicate-title checks pass.

## Existing SDK consumers

| Subsystem | Paths | Preferred placement | Status |
| --- | --- | --- | --- |
| Host shell | `src/components/shell/IconRail.svelte`, `AppSidebar.svelte`, `ProjectSidebarList.svelte` | Right for rail/collapsed sidebar actions; top for expanded sidebar actions | Pending |
| Host focus board | `src/components/focus-board/TaskListItem.svelte`, `BoardTextFilter.svelte` | Top | Pending |
| Host settings | `src/components/settings/SettingsPreferencesCard.svelte`, `ProviderSelectField.svelte`, `SettingsTaskLabelsCard.svelte` | Top | Pending |
| Host feedback | `src/components/feedback/toasts/AppToast.svelte` | Top | Pending |
| Host task detail | `src/components/task-detail/SourceTicketLink.svelte`, `TaskInspectorPanel.svelte`, `CopyButton.svelte`, `TaskDetailToolbar.svelte`, `TaskInitialPrompt.svelte`, `SelfReviewDiffPanel.svelte`, `SendToAgentPanel.svelte`, `TaskGitStatus.svelte` | Top, collision-adjusted | Pending |
| SDK | `packages/plugin-sdk/src/ui/Modal.svelte`, `CoreControlsThemeFixture.svelte` | Bottom for modal close, top in fixture | Pending |
| PR review UI | `packages/pr-review-ui/src/InlineCommentThread.svelte`, `MediaViewerDialog.svelte`, `DiffViewer.svelte`, `InlineAiReviewComment.svelte`, `FileTree.svelte`, `ReviewPrCard.svelte`, `DiffFileHeader.svelte`, `InlineExistingComment.svelte`, `RichMarkdownDiff.svelte`, `ReviewSubmitPanel.svelte` | Top, collision-adjusted | Pending |
| Terminal runtime | `packages/terminal-runtime/src/TerminalTabsShell.svelte` | Bottom for tab-bar actions | Pending |
| File viewer plugin | `plugins/file-viewer/src/FileTreeToolbar.svelte` | Bottom for toolbar actions | Pending |
| GitHub sync plugin | `plugins/github-sync/src/task/TaskPullRequestStatus.svelte`, `plugins/github-sync/src/review/pr/WalkthroughTab.svelte`, `RepositoryFilterSection.svelte`, `QuestionsPanel.svelte` | Top, collision-adjusted | Pending |
| Task browser plugin | `plugins/task-browser/src/TaskBrowserTab.svelte`, `VisualFeedbackReview.svelte`, `VisualFeedbackEditor.svelte` | Bottom for browser toolbar; top for feedback actions | Pending |
| Task schedules plugin | `plugins/task-schedules/src/components/TaskScheduleComposerSection.svelte`, `TaskScheduleInspector.svelte` | Top | Pending |

Paths abbreviated after the first path in a cell use that path's directory. Discovery found 71 IconButton template sites, including SDK fixtures. Dynamic lists can render multiple buttons per site.

## Raw controls requiring shared tooltip adoption

- Implemented: `packages/plugin-sdk/src/ui/MermaidDiagramPreview.svelte`, Zoom out, Zoom in, and Close diagram preview. Compose private TooltipControl around the existing native buttons to preserve geometry and the close-button initial-focus reference. Prefer bottom; zoom labels retain `(-)` / `(+)`. Six preview tests pass, including focus tooltips and zoom/pan behavior.
- Implemented: `packages/plugin-sdk/src/ui/PluginSidebarLink.svelte`, collapsed icon-only navigation. Private shared tooltip enabled only while collapsed, preferred right, without the duplicate native title. Existing navigation layout, active state, expanded text, and activation remain intact; six tests pass.
- Pending classification/adoption: `src/components/attention/AttentionOverviewDialog.svelte` uses a text Button containing only a close glyph. Replace it with the shared IconButton behavior.
- Pending classification/adoption: `src/components/shared/adapters/VoiceInput.svelte` can render an icon-only idle state. Preserve its recording-duration and optional-label layouts when adding shared tooltip behavior.
- Pending classification/adoption: `src/components/task-detail/TaskDetailToolbar.svelte` hides Run app and Open in VS Code labels in compact layouts. Cover those icon-only states without changing toolbar geometry.
- Implemented for the `triggerButton` branch: `packages/plugin-sdk/src/ui/AnchoredMenu.svelte` and SplitButton use the same private tooltip around their existing icon-only trigger. Disabled while the menu is open or trigger disabled. SplitButton and AnchoredMenu suites pass; arbitrary text/custom trigger snippets remain unchanged.


## Classified non-icon controls

These are not opt-outs from icon-button behavior; they do not render icon-only action buttons.

- `plugins/github-sync/src/task/PullRequestCard.svelte`: labelled collapsible section header.
- `plugins/github-sync/src/review/pr/WalkthroughStepNavigation.svelte`: numbered step pills and text-labelled Previous/Next controls. Retain step-title information; richer help is out of scope.
- `plugins/github-sync/src/review/pr/QuestionsPanel.svelte`: backdrop dismissal target and text-labelled question rows. The visible close icon already uses IconButton.
- `packages/plugin-sdk/src/ui/CollapsibleSection.svelte`: text-labelled section header. `Tooltip.svelte` is the existing standalone compatibility adapter, not an icon-button caller.
- `packages/plugin-sdk/src/ui/MermaidDiagramPreview.svelte`: 100% and Fit are text buttons.
- `packages/terminal-runtime/src/TerminalTabsShell.svelte`: labelled terminal tabs.
- `packages/pr-review-ui/src/FileTreeRow.svelte`, `DiffFileHeader.svelte`: labelled file/tree and collapsible-header controls.
- `packages/pr-review-ui/src/DiffFileContent.svelte`: image-preview activation rather than an icon action.
- `src/components/task-detail/SelfReviewChangedFilesPanel.svelte`: labelled commit rows.
- `src/components/feedback/toasts/AppToast.svelte`: message text action.
- Test mocks and test-fixture navigation buttons are not production migration targets.

## Approved mixed-control adoption

The user confirmed opt-in tooltip configuration on SDK Button. It defaults off, uses its effective aria-label, and preserves text-control styling and the native button while configuration/content changes. Empty labels leave tooltip behavior disabled.

Implemented in `VoiceInput.svelte` for its icon-only idle state, and in TaskDetailToolbar's Run app, Open in VS Code, and details-panel actions. The focused VoiceInput and toolbar suites pass (29 tests). Broader host validation and responsive visual review remain pending.

Meaningful existing title information still needs migration into labels before adoption is complete: diff-search shortcuts (⌘F, Shift+Enter, Enter, Escape), AI review approval/include/remove wording, and Reply on GitHub. Duplicate native titles on existing IconButton sites are already suppressed by the SDK; the label audit is not complete.

## Verification coverage

SDK, renderer, PR review UI, terminal runtime, and the file-viewer, github-sync, task-browser, and task-schedules plugins are affected by inherited defaults. Validate their full relevant subsystem suites and static checks, plus SDK publication contracts. Browser evidence must cover sidebar placement, dense toolbars, overflow containers, and menus/dialogs. Re-scan native titles, custom Tooltip wrappers, aliased controls, and icon-only Button usage before marking adoption complete; initial discovery is not evidence that migration has passed.
