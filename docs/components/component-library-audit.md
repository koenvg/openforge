# Component library audit

Task: KVG-1906
Date: 2026-07-05
Status: spike / inventory only — no component implementation in this task.

Historical findings below remain the 2026-07-05 audit snapshot. Current-state annotations are dated so later repository changes do not erase the evidence behind the original recommendations.

Current-state refreshes:

- 2026-07-12: Renderer paths and ownership notes affected by KVG-2052 were refreshed so this document does not direct contributors to files moved by that task.
- 2026-07-13: The remaining component inventories were reconciled after Card, ResizablePanel, modal, page-header, view-state, and file-icon consolidation. `packages/pr-review-ui/src/ui/Card.svelte` is now the only surviving copy of that generic Card. The plugin SDK owns the canonical public `Button`, `ResizablePanel`, `Modal`, `PluginPageHeader`, `PluginViewState`, `FileTypeIcon`, and `MarkdownContent` components.

## Scope

This audit covers reusable UI and repeated component patterns across:

- `src/components/shared/ui`
- `src/components/shared/adapters`
- `src/components/shared/tasks`
- repeated feature-level UI under `src/components/**`
- `packages/plugin-sdk/src/ui`
- `packages/pr-review-ui`
- `packages/terminal-runtime`
- plugin-local UI under `plugins/**`

The goal is to clarify what exists today, where boundaries are unclear, what is duplicated, what is missing, and which next tasks should come before creating more components.

## Executive summary

OpenForge has useful shared UI primitives, but it does not have one universal component-library layer. The current ownership model separates:

1. **App-private renderer tiers**: pure primitives in `src/components/shared/ui`, cross-feature host adapters in `src/components/shared/adapters`, and named domain folders such as `src/components/shared/tasks`.
2. **Public or package-level plugin surfaces** in `packages/plugin-sdk`, `packages/pr-review-ui`, and `packages/terminal-runtime`.
3. **Plugin-local copied UI in the 2026-07-05 snapshot**, especially card, modal/dialog, page header, and large page-shell patterns; later current-state annotations record which copies were consolidated.

The strongest immediate signals are:

- **Historical finding (2026-07-05):** `Card.svelte` was an exact copy in three places: `src/components/shared/ui`, `packages/pr-review-ui/src/ui`, and `plugins/github-sync/src/shared/ui`. **Current state (2026-07-13):** the app and GitHub Sync copies have been removed; only the internal PR package implementation remains.
- **Historical finding (2026-07-05):** `ResizablePanel.svelte` was effectively copied between app-private shared UI and `packages/plugin-sdk/src/ui`, differing only by the `numberParsing` import path. **Current state (2026-07-13):** the app-private copy has been removed, and app views import the canonical SDK component.
- **Historical finding (2026-07-05):** Modal/dialog chrome was repeated across app shared UI, GitHub Sync shared UI, and Roadmap dialogs. **Current state (2026-07-13):** the SDK exposes a plugin-safe `Modal`; GitHub Sync's local copy is gone, and Roadmap dialogs compose the SDK component. The app-private Modal remains separate at the renderer boundary.
- Package boundaries are intentional but not documented in one place: `@openforge-app/plugin-sdk` is public/MIT with a focused seven-component UI surface; `@openforge-app/pr-review-ui` is internal/private shared PR UI; `@openforge-app/terminal-runtime` is intended as a host-shared public runtime package rather than generic SDK UI.
- **Current addition (2026-07-13):** the SDK `Button` gives app, package, and plugin consumers one semantic action primitive. Its default `primary` variant uses the theme palette consistently; success green remains reserved for status and feedback.
- **Historical finding (2026-07-05):** several feature/plugin views were large component containers (`PrReviewView.svelte` 1115 lines, `SkillsView.svelte` 558, `TaskSchedulesView.svelte` 466, `FilesView.svelte` 434). **Current state (2026-07-13):** each is smaller and several presentational sections have been extracted, but the remaining views still own substantial orchestration.

## Layer model to adopt

Use these names consistently before adding more components:

| Layer | Intended audience | Examples today | Import rules | Notes |
| --- | --- | --- | --- | --- |
| Renderer pure UI primitives | OpenForge renderer only | `src/components/shared/ui/*` | Svelte/browser APIs, other primitives, and presentation-only renderer utilities; no IPC, stores, or domain rules | App-private despite the pure dependency boundary; not plugin-safe. |
| Renderer app-bound adapters | OpenForge renderer surfaces sharing host capabilities | `src/components/shared/adapters/*` | Pure primitives plus typed `src/lib/*` APIs such as IPC, markdown, and audio | Cross-feature host integration belongs here; not plugin-safe. |
| Domain app shared UI | OpenForge renderer features | `src/components/shared/tasks/*`, `src/components/shared/pr/*` | May depend on same-domain types/helpers, adapters, and primitives | Keep separate from generic atoms; these should not migrate into plugin SDK wholesale. |
| Plugin-safe SDK UI | Trusted plugin authors | `packages/plugin-sdk/src/ui/Button.svelte`, `MarkdownContent.svelte`, `ResizablePanel.svelte`, `Modal.svelte`, `PluginPageHeader.svelte`, `PluginViewState.svelte`, `FileTypeIcon.svelte` | Must not import app renderer stores, IPC, Electron, Rust, or private host internals | Public API; focused, stable, and MIT-compatible. Add only primitives proven by multiple plugins. |
| Internal package UI | Built-in app/plugin sharing, not public SDK | `packages/pr-review-ui` | May be package-public but should stay domain-scoped | ADR 0002 says PR review UI is internal/private shared UI, not a core platform capability. |
| Host-shared runtime UI | Plugins needing singleton lifecycle/runtime ownership | `packages/terminal-runtime` | Composes public plugin capabilities; should be externalized/host-shared | ADR 0004 says terminal runtime should not live in core plugin SDK and should avoid private host forwarding. |
| Plugin-local UI | One plugin only | `plugins/roadmap/src/components/*`, `plugins/task-schedules/src/components/*`, `plugins/file-viewer/src/*` | May use plugin SDK/public packages; must not import app-private UI | Keep until two or more plugins prove the same generic component/API. |

## Inventory

### `src/components/shared/ui`

Current files (2026-07-13):

- `AnchoredMenu.svelte` — anchor-relative menu shell.
- `ContextMenu.svelte` — minimal fixed-position menu shell.
- `ContextMenuItem.svelte` — menu item with `default` / `primary` / `danger` variants and optional `HoverTooltip` description.
- `ContextMenu.test.svelte` — test harness for `ContextMenu` and `ContextMenuItem`.
- `HoverTooltip.svelte` — tooltip wrapper with a body portal and app DOM utility imports.
- `Modal.svelte` — most complete app dialog primitive: focus handling, overlay close, configurable header, classes, close disabled state, keyboard callback, and test id.
- `ModalTestWrapper.svelte` — test helper for `Modal`.
- `PaletteFooter.svelte`, `PaletteInput.svelte`, and `PaletteListbox.svelte` — shared palette controls.
- `ResizableBottomPanel.svelte` — persistent bottom panel height with drag handle and storage key.
- `SearchableSelect.svelte` — generic searchable dropdown/select.

Historical snapshot changes:

- On 2026-07-05 this folder also contained `Card.svelte`, a generic button-card shell with `selected` / `featured` states, and `ResizablePanel.svelte`, a persistent left/right panel. KVG-1910 removed both app-private copies on 2026-07-06.
- The former Card's exact GitHub Sync copy was removed at the same time; the surviving implementation is internal to `packages/pr-review-ui/src/ui/Card.svelte`.
- The SDK `ResizablePanel` became canonical, and `src/components/task-detail/TaskDetailView.svelte` plus `src/components/task-detail/SelfReviewView.svelte` now import it from `@openforge-app/plugin-sdk/ui/ResizablePanel.svelte`.

Assessment:

- This folder is **app-private**, not a public component library, but it is now the renderer's pure-primitive tier: components here must not import IPC, stores, app services, or feature/domain types and rules. Presentation-only renderer utilities such as DOM helpers remain allowed.
- App, package, and plugin action buttons can now use the public SDK `Button`; app-private button behavior should not be duplicated here. Other common documented primitives remain hand-rolled: field/form rows, toolbar/page header, tabs, empty state, skeleton/loading state, table/list rows, status chip, toast/alert, dialog body/footer conventions, and plugin settings shell.
- Existing tests cover behavior-heavy primitives such as `Modal`, `ResizableBottomPanel`, `SearchableSelect`, and context menus, which is a good base for extraction.

### `src/components/shared/adapters`

Current files:

- `MarkdownContent.svelte` — renderer markdown rendering and external-link handling through typed app APIs.
- `ModelDownloadProgress.svelte` — shared model-download progress UI backed by desktop events and Whisper IPC.
- `VoiceInput.svelte` — shared voice capture/transcription UI backed by app audio and Whisper APIs.

Assessment:

- This folder owns cross-feature UI that adapts typed host/app capabilities. It may depend on pure primitives and `src/lib/*` APIs, but must not absorb feature-specific stores or domain rules.
- `ActionDropdown.svelte` and `CopyButton.svelte` are not shared adapters: both have a single task-detail consumer and now live under `src/components/task-detail/` with that feature.

### `src/components/shared/tasks`

Current files:

- `TaskContextMenu.svelte` — task-specific context menu with Start Task, Set aside, Return to board, and confirmed `Complete 🏁`; intentionally app-private and task-domain-specific.
- `TaskLabelEditor.svelte` — label assignment editor that loads labels through `src/lib/ipc.ts` and task label helpers.
- `TaskLabelPills.svelte` — display-only label pills.
- `TaskRelationshipDetailSection.svelte` — task relationship details with tests.

Assessment:

- This is a reasonable **domain shared** layer for task UI, not a generic component library.
- It should remain separate from `shared/ui` because it depends on task lifecycle rules and app IPC/domain types.
- The current project rule that task context menus must use `TaskContextMenu` is correctly backed by this folder.

### Repeated app feature-level UI patterns

Observed across `src/components/**`:

- Modal/dialog shells appear in app-private `Modal` and many feature dialogs.
- Header strips using `border-b border-base-300` appear broadly across app, package, and plugin surfaces.
- Badges/status chips are repeated in task detail, settings, PR review, plugin settings, terminal, and feature views.
- Context menus and action menus recur in command palette, action palette, task lists, project/sidebar, review views, and plugin management.
- Empty states are feature-local (`FocusEmptyState`, attention/review/task panes) rather than a shared primitive.
- Toast components under `src/components/feedback/toasts` are specialized (`CheckpointToast`, `CiFailureToast`, `RateLimitToast`, `TaskSpawnedToast`) rather than a generic notification component.

Assessment:

- The app already has shared leaf primitives, but feature shells still duplicate layout conventions.
- Avoid extracting every Tailwind class into components; prioritize behavior-bearing primitives and high-repeat shells such as modal/page-header/card/status-chip.

### `packages/plugin-sdk/src/ui`

Current public UI components (2026-07-13):

- `Button.svelte` — plugin-safe native button wrapper with semantic action variants and sizes; defaults positive/commit actions to the theme `primary` palette and preserves native attributes/events.
- `MarkdownContent.svelte` — plugin-safe rendered markdown wrapper backed by SDK markdown/sanitize helpers. Used by plugins such as Skills Viewer and Roadmap.
- `ResizablePanel.svelte` — canonical plugin-safe persistent left/right panel, used by app task-detail/self-review views.
- `Modal.svelte` — plugin-safe dialog primitive used by Roadmap dialogs.
- `PluginPageHeader.svelte` — shared plugin page header.
- `PluginViewState.svelte` — shared loading, error, and empty-state shell.
- `FileTypeIcon.svelte` — shared file-type icon renderer.

Package exports expose all seven through `@openforge-app/plugin-sdk/ui/<Component>.svelte`.

Assessment:

- The SDK UI surface is intentionally focused, which is good for public API stability. `Button` centralizes action semantics without turning success status color into a general CTA color.
- **Historical finding (2026-07-05):** the app and SDK `ResizablePanel` implementations were the same except for the numeric parsing import path. **Current state (2026-07-13):** KVG-1910 resolved the duplication by retaining the SDK version as the canonical public implementation and removing the app-private copy.
- Do not move feature-local components like `src/components/task-detail/CopyButton.svelte` or `ActionDropdown.svelte`, task menus, or other IPC-backed controls into SDK UI.

### `packages/pr-review-ui`

Current component/runtime surface includes:

- Public Svelte exports in `package.json`: `AuthoredPrCard.svelte`, `ReviewPrCard.svelte`, `PrStatusChip.svelte`, `FileTree.svelte`, `ReviewSubmitPanel.svelte`, `PrOverviewTab.svelte`, `DiffViewer.svelte`.
- Diff/review helpers and runes: `diffAdapter`, `diffComments`, `diffHighlighter`, `diffSearch`, `useDiffSearch.svelte`, `useDiffWorker.svelte`, `useFileContentsFetcher.svelte`, `useVirtualizer`, `reviewFileIdentity`, `timeAgo`, etc.
- Internal UI folder: `src/ui/Card.svelte` and `src/ui/PrStatusChip.svelte`.

Assessment:

- This is an internal shared PR review package, not a generic component library. ADR 0002 explicitly says PR review UI is not a core plugin SDK surface and should not become a GitHub/PR domain capability.
- `DiffViewer.svelte` is large (800 lines), but the package already has extracted state helpers and tests around accessibility, keyboard behavior, workers, sorting, highlighting, and virtualizing.
- **Historical finding (2026-07-05):** `src/ui/Card.svelte` was an exact copy of the app and GitHub Sync Card components. **Current state (2026-07-13):** KVG-1910 removed those two copies, leaving this internal PR-package component as the only surviving implementation. It should remain internal unless a new public/plugin consumer establishes a current need for a plugin-safe Card.

### `packages/terminal-runtime`

Current public exports include:

- `.` / `terminalRuntime`
- `terminalOptions`
- `theme`
- `shortcuts`
- `shortcutController`
- `TerminalTabsShell.svelte`
- `xterm.css`

Assessment:

- This is a runtime package, not a generic UI kit. ADR 0004 says it should own terminal lifecycle invariants and be host-shared to avoid duplicate terminal pools.
- `TerminalTabsShell.svelte` is a package-public Svelte surface around terminal tabs, but the package's value is lifecycle ownership, shell/session key behavior, event filtering, reconnect replay, and xterm integration.
- Do not move terminal runtime UI into `plugin-sdk/src/ui`; keep heavy xterm/WebGL/CSS/Svelte terminal concerns out of the core SDK.

### Plugin-local UI

Plugin Svelte inventory highlights from the 2026-07-05 snapshot (historical sizes retained; current consolidations noted):

- `plugins/demo-hello-world` — two tiny demo components.
- `plugins/file-viewer` — `FilesView.svelte` (434), `FileContentViewer.svelte` (246), `MarkdownFilePreview.svelte` (72), `ProjectFileTree.svelte` (196). Current `FilesView` uses the SDK `PluginPageHeader`; extracted file-browser UI uses `PluginViewState`.
- `plugins/github-sync` — `PrReviewView.svelte` (1115), `WalkthroughTab.svelte` (335), `ProjectPageHeader.svelte` (24), and local shared `Card.svelte` / `Modal.svelte`. The current tree splits PR review into sections, uses SDK `PluginPageHeader` / `PluginViewState`, and no longer contains those three local generic components.
- `plugins/roadmap` — board/card/dialog components including `CreateDialog.svelte` (220), `CardDrawer.svelte` (168), `ColumnSettingsModal.svelte` (178), `IssueContextMenu.svelte` (64), `RoadmapView.svelte` (441). Current dialog components use SDK `Modal`; `RoadmapView` uses SDK `PluginPageHeader` / `PluginViewState`.
- `plugins/task-schedules` — `TaskSchedulesView.svelte` (466). The current view and extracted list section use SDK `PluginPageHeader` / `PluginViewState`.
- `plugins/terminal` — `TaskTerminal.svelte` (246), `TerminalProjectView.svelte` (76), `TerminalTabs.svelte` (65), `TerminalTaskPane.svelte` (114).

Assessment:

- Plugin-local UI is currently doing two jobs: plugin-specific product UX and ad hoc component-library experimentation.
- **Historical finding (2026-07-05):** GitHub Sync and Skills Viewer had identical `ProjectPageHeader.svelte` files. **Current state (2026-07-13):** both local copies are gone; GitHub Sync, Skills Viewer, File Viewer, Roadmap, and Task Schedules import the SDK `PluginPageHeader`.
- **Historical finding (2026-07-05):** GitHub Sync had local copies of generic Card and Modal components. **Current state (2026-07-13):** both copies are gone, and GitHub Sync has no local shared UI folder.
- **Historical finding (2026-07-05):** Roadmap hand-rolled modal shells in multiple files. **Current state (2026-07-13):** `CreateDialog.svelte`, `CardDrawer.svelte`, and `ColumnSettingsModal.svelte` compose `@openforge-app/plugin-sdk/ui/Modal.svelte`.
- Several plugin views are large enough to make future component extraction harder; they should be split along state-container vs presentation seams before more reuse is attempted.

## Duplicated patterns and unclear boundaries

### Exact or near-exact duplicates

1. **Card**
   - **Historical duplicates (2026-07-05):** `src/components/shared/ui/Card.svelte`, `packages/pr-review-ui/src/ui/Card.svelte`, and `plugins/github-sync/src/shared/ui/Card.svelte` were byte-identical.
   - **Current state (2026-07-13):** KVG-1910 removed the app and GitHub Sync copies. `packages/pr-review-ui/src/ui/Card.svelte` remains as internal PR UI, so this exact-duplicate set no longer exists.

2. **ResizablePanel**
   - **Historical duplicates (2026-07-05):** `src/components/shared/ui/ResizablePanel.svelte` and `packages/plugin-sdk/src/ui/ResizablePanel.svelte` were functionally identical except for the `parseStrictFiniteNumber` import path.
   - **Current state (2026-07-13):** KVG-1910 removed the app-private copy. `packages/plugin-sdk/src/ui/ResizablePanel.svelte` is canonical and is imported by `src/components/task-detail/TaskDetailView.svelte` and `src/components/task-detail/SelfReviewView.svelte`.

3. **Modal/dialog chrome**
   - **Historical duplicates (2026-07-05):** `src/components/shared/ui/Modal.svelte`, `plugins/github-sync/src/shared/ui/Modal.svelte`, and modal shells in Roadmap's `CreateDialog.svelte`, `CardDrawer.svelte`, and `ColumnSettingsModal.svelte` repeated behavior and markup.
   - **Current state (2026-07-29):** `packages/plugin-sdk/src/ui/Modal.svelte` is the sole canonical implementation for both the core renderer and plugins. KVG-2802 removed the app-private copy, routed all renderer consumers through the stable SDK export, and added a source-parity guard that rejects renderer-local `Modal.svelte` implementations and non-canonical Modal imports.

4. **Project page header**
   - **Historical duplicates (2026-07-05):** `plugins/github-sync/src/project/ProjectPageHeader.svelte` and `plugins/skills-viewer/src/ProjectPageHeader.svelte` were identical.
   - **Current state (2026-07-13):** both copies are gone. `packages/plugin-sdk/src/ui/PluginPageHeader.svelte` is canonical and is imported by GitHub Sync, File Viewer, Roadmap, and Task Schedules. (Skills Viewer was retired in favour of the external `com.openforge.injectables` plugin.)

### Boundaries that need documentation or enforcement

- `src/components/shared/ui` is the app-private pure-primitive tier. Its generic name does not make it plugin-safe; host/app dependencies belong in `src/components/shared/adapters` and feature/domain dependencies belong beside their owner.
- `packages/plugin-sdk/src/ui` is public API. Every new component here becomes an author contract; require stronger justification than "two app files look similar".
- `packages/pr-review-ui` has package-public exports but is intentionally internal/domain-scoped. Avoid treating it as a generic source for SDK components.
- `packages/terminal-runtime` is host-shared runtime UI, not a UI atom library. Keep terminal lifecycle in that package and generic UI elsewhere.
- Built-in plugins must not import `src/components/shared/ui` directly. They should use plugin SDK UI, public runtime packages, package-private shared components, or local components.

## Missing components / capabilities

Do not add all of these at once. This is a backlog of proven gaps:

- **Historical gap (2026-07-05): plugin-safe dialog/modal primitive. Current state (2026-07-13):** `packages/plugin-sdk/src/ui/Modal.svelte` provides this capability and is used by Roadmap dialogs.
- **Plugin-safe card/list item primitive** only if a new public/plugin consumer emerges. The 2026-07-05 three-copy Card finding has been resolved, and the remaining Card is internal to the PR package.
- **Page/view shell:** SDK `PluginPageHeader` and `PluginViewState` now cover shared header plus loading/error/empty states; a unified scroll/layout shell remains unproven.
- **Status chip/badge primitive** with semantic variants, separate from domain-specific task/PR status mapping.
- **Action menu/context menu primitive** that does not depend on app `Action` types or task lifecycle rules.
- **Form field/setting row primitives** for plugin settings and configuration UIs.
- **Empty state primitive** with icon/title/body/action slots.
- **Error boundary/fallback UI conventions** for package/plugin render slots.
- **Component boundary docs** explaining app-private, plugin-safe, internal-package, and host-shared runtime layers.

## Recommendations

### Do now

1. **Document the layer boundaries and keep all renderer shared tiers app-private.**
   - Completed by the renderer tier documentation linked from `src/components/shared/README.md` and `docs/ui-component-boundaries.md`.
   - Plugins must not import `src/components/shared/ui`, `src/components/shared/adapters`, or another root `src/**` path.

2. **Deduplicate exact copies first, but only after choosing ownership. — Completed by KVG-1910.**
   - Card duplication was removed by retaining the internal PR-package implementation and deleting the unused app and GitHub Sync copies.
   - `ResizablePanel` now has one canonical plugin-safe implementation in `packages/plugin-sdk/src/ui`, used by the app through the public SDK export.

3. **Create a plugin-safe dialog/modal before migrating plugin dialogs. — Implemented in the current tree.**
   - The SDK now owns `Modal.svelte`; Roadmap's dialog components import it, and the former GitHub Sync local copy has been removed.

4. **Split large plugin views before extracting generic components from them.**
   - `PrReviewView`, `SkillsView`, `TaskSchedulesView`, and `FilesView` are too large to be good component-library source material without first separating state orchestration from presentational sections.

5. **Add package-boundary tests for new public UI exports.**
   - Follow the spirit of existing package boundary tests: SDK UI must not import app renderer internals, IPC, Electron, or Rust-sidecar code.

### Later

- SDK `PluginPageHeader` and `PluginViewState` have standardized plugin headers and loading/error/empty states. Promote a fuller page shell, setting row, or status-chip primitive only after equivalent remaining patterns appear in two or more plugins.
- Consider a private workspace UI package only if app and internal packages need shared source without making it public SDK API.
- Build component examples or a lightweight catalog after ownership is clear; do not start with Storybook/catalog work before boundaries settle.
- Add lint/import-boundary rules to prevent plugins from importing app-private UI.
- Revisit `packages/pr-review-ui` component size after PR review workflow stabilizes; extract only domain-coherent subcomponents.

### Do not do

- Do not move `TaskContextMenu`, `TaskLabelEditor`, feature-local controls such as `src/components/task-detail/CopyButton.svelte` or `ActionDropdown.svelte`, or other IPC/store-backed controls into `@openforge-app/plugin-sdk/ui`.
- Do not put terminal/xterm components into the core plugin SDK; keep `@openforge-app/terminal-runtime` separate and host-shared.
- Do not make `@openforge-app/pr-review-ui` a general component library or public PR platform API.
- Do not create wrappers for every Tailwind/daisyUI class combination. Favor behavior-bearing components and repeated semantic shells.
- Do not migrate all plugin-local UI in one broad PR. Extract one primitive at a time with tests and package-boundary checks.

## Recommended next tasks

1. **KVG-1909 — Define component layer boundaries and import rules**
   - Prompt: "Document and enforce OpenForge UI component layer boundaries: app-private shared UI, domain shared UI, plugin-safe SDK UI, internal package UI, and host-shared runtime UI. Add import-boundary tests/lints so plugins cannot import app-private components."

2. **KVG-1910 — Deduplicate cloned `Card` and `ResizablePanel` components — Completed 2026-07-06**
   - Historical prompt: "Choose ownership for cloned Card and ResizablePanel components, then deduplicate `src/components/shared/ui/Card.svelte`, `packages/pr-review-ui/src/ui/Card.svelte`, `plugins/github-sync/src/shared/ui/Card.svelte`, and the app/plugin-sdk ResizablePanel copies without widening app-private APIs."
   - Current outcome: removed the app and GitHub Sync Card copies, retained the internal PR-package Card, removed the app-private ResizablePanel, and made the SDK ResizablePanel canonical for both plugin-safe and app consumers.

3. **KVG-1911 — Design a plugin-safe modal/dialog primitive — Implemented in the current tree**
   - Historical prompt: "Create a plugin-safe modal/dialog primitive based on the app Modal behavior, expose it only through the appropriate public/package layer, and migrate GitHub Sync/Roadmap duplicated modal shells with focused tests."
   - Current outcome: the SDK exports `Modal.svelte`, Roadmap dialogs use it, and GitHub Sync no longer carries a local Modal copy.

4. **KVG-1912 — Split large plugin view containers before component extraction**
   - Historical prompt: "Refactor large built-in plugin view containers (`PrReviewView.svelte`, `SkillsView.svelte`, `TaskSchedulesView.svelte`, `FilesView.svelte`) into state containers plus presentational sections so reusable UI can be extracted safely later."
   - Current progress: the views are smaller and now have extracted PR review, skills list, task schedules list, and file-browser sections, but further orchestration/presentation separation may still be useful.
5. **KVG-1913 — Consolidate plugin page headers and empty/loading/error shells — Implemented in the current tree**
   - Historical prompt: "Extract or standardize plugin page header and view-state shells currently duplicated across GitHub Sync, Skills Viewer, File Viewer, Roadmap, and Task Schedules, keeping the result plugin-safe and SDK-appropriate only if the API is stable."
   - Current outcome: the SDK exports `PluginPageHeader.svelte` and `PluginViewState.svelte`; built-in plugin consumers use them instead of local page-header and view-state copies.
