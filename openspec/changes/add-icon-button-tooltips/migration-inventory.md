# Icon-button tooltip migration inventory

Audit complete. Existing IconButton consumers inherit the shared behavior without wrappers. Defaults are top/center/6px with collision adjustment. No production icon-only action requires an opt-out. Disabled/loading suppression is shared behavior, not an adoption exception.

## Existing SDK consumers

Paths abbreviated after the first path in a cell use that path's directory. All rows are implemented and their affected subsystem tests/static checks have passed; see verification.md.

| Subsystem | Paths | Preferred placement |
| --- | --- | --- |
| Host shell | `src/components/shell/IconRail.svelte`, `AppSidebar.svelte`, `ProjectSidebarList.svelte` | Right for rail/collapsed navigation; top for expanded actions |
| Host focus board | `src/components/focus-board/TaskListItem.svelte`, `BoardTextFilter.svelte` | Top |
| Host settings | `src/components/settings/SettingsPreferencesCard.svelte`, `ProviderSelectField.svelte`, `SettingsTaskLabelsCard.svelte` | Top |
| Host feedback | `src/components/feedback/toasts/AppToast.svelte` | Top |
| Host task detail | `src/components/task-detail/SourceTicketLink.svelte`, `TaskInspectorPanel.svelte`, `CopyButton.svelte`, `TaskDetailToolbar.svelte`, `TaskInitialPrompt.svelte`, `SelfReviewDiffPanel.svelte`, `SendToAgentPanel.svelte`, `TaskGitStatus.svelte` | Top, collision-adjusted |
| SDK modal | `packages/plugin-sdk/src/ui/Modal.svelte` | Bottom for close |
| PR review UI | `packages/pr-review-ui/src/InlineCommentThread.svelte`, `MediaViewerDialog.svelte`, `DiffViewer.svelte`, `InlineAiReviewComment.svelte`, `FileTree.svelte`, `ReviewPrCard.svelte`, `DiffFileHeader.svelte`, `InlineExistingComment.svelte`, `RichMarkdownDiff.svelte`, `ReviewSubmitPanel.svelte` | Top, collision-adjusted |
| Terminal runtime | `packages/terminal-runtime/src/TerminalTabsShell.svelte` | Bottom for tab-bar close actions |
| File viewer plugin | `plugins/file-viewer/src/FileTreeToolbar.svelte` | Bottom |
| GitHub sync plugin | `plugins/github-sync/src/task/TaskPullRequestStatus.svelte`, `plugins/github-sync/src/review/pr/WalkthroughTab.svelte`, `RepositoryFilterSection.svelte`, `QuestionsPanel.svelte` | Top, collision-adjusted |
| Task browser plugin | `plugins/task-browser/src/TaskBrowserTab.svelte`, `VisualFeedbackReview.svelte`, `VisualFeedbackEditor.svelte` | Bottom for browser toolbar; top for feedback actions |
| Task schedules plugin | `plugins/task-schedules/src/components/TaskScheduleComposerSection.svelte`, `TaskScheduleInspector.svelte` | Top |

Initial discovery found 71 IconButton template sites including SDK fixtures. Dynamic lists can render multiple buttons per site. Subsequent AST scans checked native buttons and Button consumers, including short glyph-only content. The short-content scan found the already-composed Mermaid icons plus classified text/backdrop controls. A final scan found no production `data-tip` or `class="tooltip..."` wrappers.

## Additional shared adoption

- `packages/plugin-sdk/src/ui/MermaidDiagramPreview.svelte`: zoom out/in and close compose TooltipControl around their native buttons. Bottom placement preserves toolbar geometry and the close-button initial-focus reference. Zoom labels retain `(-)` and `(+)`.
- `packages/plugin-sdk/src/ui/PluginSidebarLink.svelte`: collapsed navigation composes the same behavior, enabled only while collapsed, preferred right. Expanded text, navigation state, and activation are unchanged.
- `packages/plugin-sdk/src/ui/AnchoredMenu.svelte`: the icon-only triggerButton branch, including SplitButton, shares TooltipControl. Suppressed while its menu is open or trigger disabled; custom/text trigger snippets remain unchanged.
- `src/components/attention/AttentionOverviewDialog.svelte`: its close glyph opts into Button tooltips with bottom placement, retaining existing button geometry.
- `src/components/shared/adapters/VoiceInput.svelte`: the icon-only idle state opts into Button tooltips. The label includes the existing shortcut; recording-duration and optional-label layouts are unchanged.
- `src/components/task-detail/TaskDetailToolbar.svelte`: Run app, Open in VS Code, and details-panel actions opt into Button tooltips, retaining the same button as CSS hides or shows text. Run-app title details are included in its accessible label.

## Label and duplicate-presentation audit

- Diff search retains ⌘F, Shift+Enter, Enter, and Escape in accessible labels.
- AI approval/un-approval labels retain include/remove-from-review wording.
- Existing-comment reply retains GitHub wording.
- Native IconButton titles equal to or less informative than their labels are suppressed centrally. Retained title props do not produce a second browser tooltip. Rail/project duplicate props were replaced with explicit placement.
- Voice's text-labelled states retain their pre-existing native title behavior; its automatic icon-only tooltip does not duplicate that title.
- Role-based tests replace obsolete native-title selectors; they continue to verify activation, review navigation, copying, and search behavior.

## Non-icon controls retained

These are not opt-outs: they display text or are nonvisual dismissal targets.

- PullRequestCard and CollapsibleSection labelled headers; file/tree rows and collapsible file headers; image-preview activation; labelled commit rows and terminal tabs; toast message actions.
- WalkthroughStepNavigation numbered step pills and text-labelled Previous/Next controls. Step-title information remains available; rich help is out of scope.
- QuestionsPanel backdrop and text-labelled rows; its visible close action already uses IconButton.
- Mermaid 100% and Fit text buttons.
- TicketCoveragePanel Add to review/Added controls, hierarchical settings Expand/Collapse/Reset controls, settings category navigation, hidden-projects text toggle, project mode radio cards, Back to diff, Add ticket link, and Back controls.
- Short text actions such as Ask, Add, Go, and All are not icon-only controls.
- Test fixtures are not production adoption targets. TooltipBrowserTestWrapper has a validated test-only Storybook coverage exclusion.

## Verification scope

SDK, renderer, PR review UI, terminal runtime, and file-viewer, github-sync, task-browser, task-schedules, and terminal plugins were validated. The Terminal plugin consumes the modified tab shell, so its own suite and bundle were included. Shared SDK behavior is also exercised by published npm/Bun consumers, real Storybook interactions, and the canonical Linux screenshot matrix. See verification.md for commands, results, and disclosed optional skips.
