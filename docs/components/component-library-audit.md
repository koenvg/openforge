# Component library audit

Task: KVG-1906
Date: 2026-07-05
Status: spike / inventory only — no component implementation in this task.

Historical findings below remain the 2026-07-05 audit snapshot. Renderer paths and ownership notes affected by KVG-2052 were refreshed on 2026-07-12 so this document does not direct contributors to files moved by that task.

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
3. **Plugin-local copied UI** in built-in plugins, especially card, modal/dialog, page header, and large page-shell patterns.

The strongest immediate signals are:

- `Card.svelte` is an exact copy in three places: `src/components/shared/ui`, `packages/pr-review-ui/src/ui`, and `plugins/github-sync/src/shared/ui`.
- `ResizablePanel.svelte` is effectively copied between app-private shared UI and `packages/plugin-sdk/src/ui`, differing only by the `numberParsing` import path.
- Modal/dialog chrome is repeated across app shared UI, GitHub Sync shared UI, and Roadmap dialogs instead of having one plugin-safe dialog primitive.
- Package boundaries are intentional but not documented in one place: `@openforge-app/plugin-sdk` is public/MIT and tiny; `@openforge-app/pr-review-ui` is internal/private shared PR UI; `@openforge-app/terminal-runtime` is intended as a host-shared public runtime package rather than generic SDK UI.
- Feature/plugin views contain several large component containers (`PrReviewView.svelte` 1115 lines, `SkillsView.svelte` 558, `TaskSchedulesView.svelte` 466, `FilesView.svelte` 434) that mix state orchestration, layout shell, and reusable leaf UI.

## Layer model to adopt

Use these names consistently before adding more components:

| Layer | Intended audience | Examples today | Import rules | Notes |
| --- | --- | --- | --- | --- |
| Renderer pure UI primitives | OpenForge renderer only | `src/components/shared/ui/*` | Svelte/browser APIs, other primitives, and presentation-only renderer utilities; no IPC, stores, or domain rules | App-private despite the pure dependency boundary; not plugin-safe. |
| Renderer app-bound adapters | OpenForge renderer surfaces sharing host capabilities | `src/components/shared/adapters/*` | Pure primitives plus typed `src/lib/*` APIs such as IPC, markdown, and audio | Cross-feature host integration belongs here; not plugin-safe. |
| Domain app shared UI | OpenForge renderer features | `src/components/shared/tasks/*`, `src/components/shared/pr/*` | May depend on same-domain types/helpers, adapters, and primitives | Keep separate from generic atoms; these should not migrate into plugin SDK wholesale. |
| Plugin-safe SDK UI | Trusted plugin authors | `packages/plugin-sdk/src/ui/MarkdownContent.svelte`, `ResizablePanel.svelte` | Must not import app renderer stores, IPC, Electron, Rust, or private host internals | Public API; small, stable, and MIT-compatible. Add only primitives proven by multiple plugins. |
| Internal package UI | Built-in app/plugin sharing, not public SDK | `packages/pr-review-ui` | May be package-public but should stay domain-scoped | ADR 0002 says PR review UI is internal/private shared UI, not a core platform capability. |
| Host-shared runtime UI | Plugins needing singleton lifecycle/runtime ownership | `packages/terminal-runtime` | Composes public plugin capabilities; should be externalized/host-shared | ADR 0004 says terminal runtime should not live in core plugin SDK and should avoid private host forwarding. |
| Plugin-local UI | One plugin only | `plugins/roadmap/src/components/*`, `plugins/task-schedules/src/components/*`, `plugins/file-viewer/src/*` | May use plugin SDK/public packages; must not import app-private UI | Keep until two or more plugins prove the same generic component/API. |

## Inventory

### `src/components/shared/ui`

Current files:

- `Card.svelte` — generic button-card shell with `selected` / `featured` states. Exact copy also exists in `packages/pr-review-ui/src/ui/Card.svelte` and `plugins/github-sync/src/shared/ui/Card.svelte`.
- `ContextMenu.svelte` — minimal fixed-position menu shell.
- `ContextMenuItem.svelte` — menu item with `default` / `primary` / `danger` variants and optional `HoverTooltip` description.
- `HoverTooltip.svelte` — tooltip wrapper with a body portal and app DOM utility imports.
- `Modal.svelte` — most complete app dialog primitive: focus handling, overlay close, configurable header, classes, close disabled state, keyboard callback, and test id.
- `ModalTestWrapper.svelte` — test helper for `Modal`.
- `ResizableBottomPanel.svelte` — persistent bottom panel height with drag handle and storage key.
- `ResizablePanel.svelte` — persistent left/right panel width with drag handle and storage key. Duplicated in `packages/plugin-sdk/src/ui/ResizablePanel.svelte`.
- `SearchableSelect.svelte` — generic searchable dropdown/select.

Assessment:

- This folder is **app-private**, not a public component library, but it is now the renderer's pure-primitive tier: components here must not import IPC, stores, app services, or feature/domain types and rules. Presentation-only renderer utilities such as DOM helpers remain allowed.
- It is missing common documented primitives that other code already hand-rolls: button wrappers, field/form rows, toolbar/page header, tabs, empty state, skeleton/loading state, table/list rows, status chip, toast/alert, dialog body/footer conventions, and plugin settings shell.
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

Current files:

- `MarkdownContent.svelte` — plugin-safe rendered markdown wrapper backed by SDK markdown/sanitize helpers. Used by plugins such as Skills Viewer and Roadmap.
- `ResizablePanel.svelte` — plugin-safe copy of app `ResizablePanel`, exported publicly as `@openforge-app/plugin-sdk/ui/ResizablePanel.svelte`.

Package exports currently expose only:

- `@openforge-app/plugin-sdk/ui/MarkdownContent.svelte`
- `@openforge-app/plugin-sdk/ui/ResizablePanel.svelte`

Assessment:

- The SDK UI surface is intentionally tiny, which is good for public API stability.
- `ResizablePanel` duplication is a maintenance smell: the app and SDK implementations are the same except import path. Either make the SDK version the canonical implementation for plugin-safe usage or generate/share a common source without widening app-private APIs.
- Do not move feature-local components like `src/components/task-detail/CopyButton.svelte` or `ActionDropdown.svelte`, task menus, or other IPC-backed controls into SDK UI.

### `packages/pr-review-ui`

Current component/runtime surface includes:

- Public Svelte exports in `package.json`: `AuthoredPrCard.svelte`, `ReviewPrCard.svelte`, `PrStatusChip.svelte`, `FileTree.svelte`, `ReviewSubmitPanel.svelte`, `PrOverviewTab.svelte`, `DiffViewer.svelte`.
- Diff/review helpers and runes: `diffAdapter`, `diffComments`, `diffHighlighter`, `diffSearch`, `useDiffSearch.svelte`, `useDiffWorker.svelte`, `useFileContentsFetcher.svelte`, `useVirtualizer`, `reviewFileIdentity`, `timeAgo`, etc.
- Internal UI folder: `src/ui/Card.svelte` and `src/ui/PrStatusChip.svelte`.

Assessment:

- This is an internal shared PR review package, not a generic component library. ADR 0002 explicitly says PR review UI is not a core plugin SDK surface and should not become a GitHub/PR domain capability.
- `DiffViewer.svelte` is large (800 lines), but the package already has extracted state helpers and tests around accessibility, keyboard behavior, workers, sorting, highlighting, and virtualizing.
- `src/ui/Card.svelte` is an exact copy of the app and GitHub Sync `Card` component. If `Card` is needed by multiple package/plugin surfaces, it should be promoted deliberately into a plugin-safe/public UI layer or shared source, not copied package-by-package.

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

Plugin Svelte inventory:

- `plugins/demo-hello-world` — two tiny demo components.
- `plugins/file-viewer` — `FilesView.svelte` (434), `FileContentViewer.svelte` (246), `MarkdownFilePreview.svelte` (72), `ProjectFileTree.svelte` (196).
- `plugins/github-sync` — `PrReviewView.svelte` (1115), `WalkthroughTab.svelte` (335), `ProjectPageHeader.svelte` (24), plus local shared `Card.svelte` and `Modal.svelte`.
- `plugins/roadmap` — board/card/dialog components including `CreateDialog.svelte` (220), `CardDrawer.svelte` (168), `ColumnSettingsModal.svelte` (178), `IssueContextMenu.svelte` (64), `RoadmapView.svelte` (441).
- `plugins/skills-viewer` — `SkillsView.svelte` (558), `ProjectPageHeader.svelte` (24), markdown test double.
- `plugins/task-schedules` — `TaskSchedulesView.svelte` (466).
- `plugins/terminal` — `TaskTerminal.svelte` (246), `TerminalProjectView.svelte` (76), `TerminalTabs.svelte` (65), `TerminalTaskPane.svelte` (114).

Assessment:

- Plugin-local UI is currently doing two jobs: plugin-specific product UX and ad hoc component-library experimentation.
- GitHub Sync and Skills Viewer both have identical `ProjectPageHeader.svelte` files.
- GitHub Sync has local copies of generic `Card` and `Modal` even though similar app/package components exist.
- Roadmap hand-rolls modal shells in multiple files instead of using one plugin-safe dialog primitive.
- Several plugin views are large enough to make future component extraction harder; they should be split along state-container vs presentation seams before more reuse is attempted.

## Duplicated patterns and unclear boundaries

### Exact or near-exact duplicates

1. **Card**
   - `src/components/shared/ui/Card.svelte`
   - `packages/pr-review-ui/src/ui/Card.svelte`
   - `plugins/github-sync/src/shared/ui/Card.svelte`
   - These are byte-identical today.

2. **ResizablePanel**
   - `src/components/shared/ui/ResizablePanel.svelte`
   - `packages/plugin-sdk/src/ui/ResizablePanel.svelte`
   - These are functionally identical except for `parseStrictFiniteNumber` import path.

3. **Modal/dialog chrome**
   - `src/components/shared/ui/Modal.svelte`
   - `plugins/github-sync/src/shared/ui/Modal.svelte`
   - `plugins/roadmap/src/components/CreateDialog.svelte`
   - `plugins/roadmap/src/components/CardDrawer.svelte`
   - `plugins/roadmap/src/components/ColumnSettingsModal.svelte`
   - The app component has better behavior/focus affordances; plugin-local versions repeat the shell markup with fewer features.

4. **Project page header**
   - `plugins/github-sync/src/project/ProjectPageHeader.svelte`
   - `plugins/skills-viewer/src/ProjectPageHeader.svelte`
   - This looks like a candidate for plugin-local shared shell or SDK/plugin-safe page header if more plugins converge.

### Boundaries that need documentation or enforcement

- `src/components/shared/ui` is the app-private pure-primitive tier. Its generic name does not make it plugin-safe; host/app dependencies belong in `src/components/shared/adapters` and feature/domain dependencies belong beside their owner.
- `packages/plugin-sdk/src/ui` is public API. Every new component here becomes an author contract; require stronger justification than "two app files look similar".
- `packages/pr-review-ui` has package-public exports but is intentionally internal/domain-scoped. Avoid treating it as a generic source for SDK components.
- `packages/terminal-runtime` is host-shared runtime UI, not a UI atom library. Keep terminal lifecycle in that package and generic UI elsewhere.
- Built-in plugins must not import `src/components/shared/ui` directly. They should use plugin SDK UI, public runtime packages, package-private shared components, or local components.

## Missing components / capabilities

Do not add all of these at once. This is a backlog of proven gaps:

- **Plugin-safe dialog/modal primitive** with focus/overlay/escape behavior and header/body/footer slots.
- **Plugin-safe card/list item primitive** if `Card` continues to be needed in app, PR package, and plugins.
- **Page/view shell** for plugin pages: title/subtitle/actions header, scroll region, error/loading/empty slots.
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

2. **Deduplicate exact copies first, but only after choosing ownership.**
   - `Card` needs a single owner or a generated/shared source.
   - `ResizablePanel` should have one canonical plugin-safe implementation or a shared implementation helper.

3. **Create a plugin-safe dialog/modal task before migrating plugin dialogs.**
   - Start from `src/components/shared/ui/Modal.svelte` behavior, but remove app-private assumptions and package it through the SDK only if the public API is stable enough.

4. **Split large plugin views before extracting generic components from them.**
   - `PrReviewView`, `SkillsView`, `TaskSchedulesView`, and `FilesView` are too large to be good component-library source material without first separating state orchestration from presentational sections.

5. **Add package-boundary tests for new public UI exports.**
   - Follow the spirit of existing package boundary tests: SDK UI must not import app renderer internals, IPC, Electron, or Rust-sidecar code.

### Later

- Promote plugin page shell, empty state, setting row, and status-chip primitives after two or more plugins adopt equivalent local patterns.
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

2. **KVG-1910 — Deduplicate cloned `Card` and `ResizablePanel` components**
   - Prompt: "Choose ownership for cloned Card and ResizablePanel components, then deduplicate `src/components/shared/ui/Card.svelte`, `packages/pr-review-ui/src/ui/Card.svelte`, `plugins/github-sync/src/shared/ui/Card.svelte`, and the app/plugin-sdk ResizablePanel copies without widening app-private APIs."

3. **KVG-1911 — Design a plugin-safe modal/dialog primitive**
   - Prompt: "Create a plugin-safe modal/dialog primitive based on the app Modal behavior, expose it only through the appropriate public/package layer, and migrate GitHub Sync/Roadmap duplicated modal shells with focused tests."

4. **KVG-1912 — Split large plugin view containers before component extraction**
   - Prompt: "Refactor large built-in plugin view containers (`PrReviewView.svelte`, `SkillsView.svelte`, `TaskSchedulesView.svelte`, `FilesView.svelte`) into state containers plus presentational sections so reusable UI can be extracted safely later."
5. **KVG-1913 — Consolidate plugin page headers and empty/loading/error shells**
   - Prompt: "Extract or standardize plugin page header and view-state shells currently duplicated across GitHub Sync, Skills Viewer, File Viewer, Roadmap, and Task Schedules, keeping the result plugin-safe and SDK-appropriate only if the API is stable."
