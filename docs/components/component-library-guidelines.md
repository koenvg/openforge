# OpenForge component-library guidelines

Task: KVG-1907
Source audit: [KVG-1906 component-library audit](./component-library-audit.md)

These guidelines document the component-library conventions that are already supported by the KVG-1906 audit. They are intentionally narrower than a full design-system roadmap: do not use this document as permission to migrate large feature views, publish new SDK exports, or extract every repeated Tailwind class. When a rule below points to work that needs design or enforcement, track that as a follow-up task.

## Goals and non-goals

Goals:

- Give contributors one vocabulary for the current UI layers.
- Keep app-private UI, plugin-safe SDK UI, internal package UI, host-shared runtime UI, and plugin-local UI from drifting together.
- Define practical component API, accessibility, styling, export, documentation, and testing expectations.
- Make future extraction decisions deliberate instead of copy/paste driven.

Non-goals:

- No broad component migration in this task.
- No Storybook/catalog requirement until ownership boundaries settle.
- No new public SDK component just because two app views share similar markup.
- No generic wrappers for every Tailwind/daisyUI class combination.

## Ownership layers

Use these layer names in docs, reviews, and follow-up tasks.

| Layer | Owner / audience | Allowed dependencies | Export posture | Current examples |
| --- | --- | --- | --- | --- |
| App-private UI | OpenForge renderer only | `src/lib/*`, IPC wrappers, renderer stores, app domain types, app DOM utilities | Imported through app source only; not a plugin contract | `src/components/shared/ui/*` |
| Domain app shared UI | OpenForge renderer features for one domain | App domain types and app-private helpers for that domain | Shared inside the app; not generic SDK UI | `src/components/shared/tasks/*` |
| Plugin-safe SDK UI | Trusted plugin authors using public SDK exports | Only SDK/public helpers and normal Svelte/browser APIs; no app internals | Stable public package exports from `@openforge-app/plugin-sdk` | `MarkdownContent.svelte`, `ResizablePanel.svelte`, `Modal.svelte` |
| Internal package UI | Internal workspace packages for a domain | Package-local domain helpers; avoid app-private imports unless the package explicitly owns that boundary | Package-public but domain-scoped, not generic UI | `packages/pr-review-ui` |
| Host-shared runtime UI | Runtime packages that must own singleton/lifecycle behavior | Runtime package internals plus public plugin capabilities | Public or host-shared runtime API, not core SDK atoms | `packages/terminal-runtime` |
| Plugin-local UI | One built-in or external plugin | Plugin SDK exports, public runtime packages, plugin-local code | Private to that plugin until reuse is proven | `plugins/*/src/**` components |

Boundary rules:

- Treat `src/components/shared/ui` as **app-private** until a follow-up explicitly splits app-safe from plugin-safe components.
- Built-in plugins must not import `src/components/shared/ui`, `src/lib/*`, Electron/preload code, Rust sidecar APIs, or app stores directly.
- Do not move `TaskContextMenu`, `TaskLabelEditor`, `CopyButton`, app action dropdowns, task lifecycle controls, IPC-backed controls, or store-backed controls into `@openforge-app/plugin-sdk/ui`.
- Keep `packages/pr-review-ui` as PR-review-domain UI. Do not turn it into a generic component library or public PR platform API.
- Keep `packages/terminal-runtime` separate from the core plugin SDK. Terminal/xterm lifecycle, PTY session invariants, WebGL/xterm CSS, reconnect replay, and shell key behavior belong in the runtime package.
- Plugin-local UI can remain local when only one plugin needs it. Promote only after at least two surfaces prove the same semantic primitive and a stable API.

## Component naming conventions

Name components by semantic responsibility, not implementation detail.

- **Generic behavior or shell primitives**: use nouns that describe the reusable contract, such as `Modal`, `ResizablePanel`, `SearchableSelect`, `ContextMenu`, `ContextMenuItem`, `MarkdownContent`.
- **Domain components**: include the domain noun when the component encodes product rules, such as `TaskContextMenu`, `TaskLabelEditor`, `PrStatusChip`, `ReviewSubmitPanel`.
- **Runtime components**: name around the runtime ownership, such as `TerminalTabsShell`, rather than generic `Tabs`.
- **Feature containers/views**: keep `*View` or `*Page` names for orchestration-level components that load data, own state, or register plugin/app integrations.
- **Presentation sections**: prefer names that describe the section role (`PrOverviewTab`, `FileTree`, `ProjectPageHeader`) once state orchestration has been separated.

Do not use a generic name for a component that imports domain types or app-private helpers. For example, a task lifecycle menu is `TaskContextMenu`, not `ContextMenu`.

## Svelte 5 component API conventions

All new or substantially changed Svelte components must follow the project Svelte 5 conventions.

- Use runes: `$state`, `$derived`, `$effect`, and `$props()`.
- Define a local `Props` interface and destructure props from `$props()`.
- Use `import type` for type-only imports because `verbatimModuleSyntax` is enforced.
- Use nullable fields as `T | null`, not optional fields, when the value is intentionally present-but-empty.
- Use `on`-prefixed callback props (`onClose`, `onSelect`, `onResize`, `onOpenUrl`) instead of legacy event dispatchers.
- Keep callbacks narrow and semantic. Pass domain values, not raw DOM events, unless the component is explicitly a low-level DOM primitive.
- Avoid two-way implicit ownership. If a component persists size, selection, or expanded state, document whether the state is caller-owned, internally owned, or stored under a provided key.
- For `Map`-based state, assign `new Map(...)` to trigger Svelte reactivity; do not rely on direct `.set()` mutation.
- Do not use `$effect` return cleanup for resources keyed by a prop value. Compare the previous logical key inside the effect and use `onDestroy` for component teardown.

Plugin component entry points also receive `api` and `context` props from the plugin host. They should use SDK capabilities instead of importing OpenForge app internals.

## Accessibility requirements

Reusable components must own the accessibility behavior implied by their contract. Do not leave each caller to rediscover it.

Minimum expectations:

- Interactive controls use native `<button>`, `<a>`, `<input>`, `<select>`, and related elements whenever possible.
- Icon-only controls need an accessible label (`aria-label` or visible text from the caller).
- Dialog/modal primitives must define focus behavior, escape handling, overlay behavior, accessible naming, and close-disabled behavior before they are promoted beyond plugin-local code.
- Menus and searchable/select controls need keyboard behavior that matches their role and tests for selection/close behavior.
- Components that open external URLs must delegate through the relevant host capability (`openUrl()` IPC in app code, `openforge.system.openUrl` in plugins), not raw browser/Electron APIs.
- Rendered markdown/html components must use the existing sanitized markdown path for their layer, such as SDK markdown/sanitize helpers for plugin-safe UI.

If a copied component has weaker accessibility behavior than the app-private version, do not promote it as-is. Create or use a follow-up task to design a plugin-safe primitive with the stronger behavior.

## Tailwind and daisyUI token usage

OpenForge uses Tailwind CSS v4 and daisyUI v5 with CSS-first configuration in `src/app.css`.

- Prefer Tailwind utilities and daisyUI semantic classes over component-specific CSS.
- Use daisyUI semantic tokens (`base-*`, `primary`, `secondary`, `accent`, `neutral`, `info`, `success`, `warning`, `error`) instead of hardcoded hex colors.
- Use established app focus treatment (`ring-2 ring-primary rounded`) for keyboard focus when a custom focus affordance is needed.
- `<style>` blocks are acceptable for component-scoped keyframes or `:global()` resets around rendered HTML/markdown content.
- Do not extract a component only to hide a common class list. Extract when the component carries behavior, accessibility, package-boundary value, or a repeated semantic shell.
- Public/plugin-safe components should expose semantic variants sparingly. Avoid leaking app-only color semantics or feature-specific status mappings into generic SDK UI.

## Public export and package rules

A public Svelte export is a product/API decision.

Before adding an export under `@openforge-app/plugin-sdk/ui/*`, confirm:

1. The component is plugin-safe: no imports from `src/`, Electron main/preload, app stores, Rust sidecar code, or undocumented package internals.
2. The component solves a repeated plugin-safe need, not an app-only or one-plugin need.
3. The props form a small stable contract that plugin authors can rely on.
4. Accessibility and behavior are tested at the package boundary.
5. Documentation/examples explain the supported import path and expected usage.

Package guidance:

- `@openforge-app/plugin-sdk/ui` should remain small and public. Add only stable, plugin-safe primitives.
- `@openforge-app/pr-review-ui` may export PR-review components and helpers, but those exports remain domain-scoped.
- `@openforge-app/terminal-runtime` owns terminal runtime UI and lifecycle. Do not re-export terminal components from the core SDK.
- A private workspace UI package may be considered later if app and internal packages need shared source without making it public SDK API. That is a separate design task, not a default path.

## Examples and documentation expectations

When adding or promoting a component, include enough documentation for its layer.

- App-private/domain components: document unusual lifecycle behavior, destructive actions, host IPC use, and domain invariants in the component or adjacent docs/tests.
- Plugin-safe SDK components: update plugin authoring or SDK reference docs with import path, minimal example, props/callbacks, accessibility notes, and testing guidance.
- Internal package UI: document domain assumptions and whether the export is intended for app internals only.
- Runtime UI: document lifecycle ownership and singleton/host-sharing expectations.

Examples should show the supported import path and a realistic usage. Do not create a catalog/storybook as a prerequisite unless a follow-up task explicitly chooses that investment.

## Testing expectations

Tests should cover behavior and package boundaries, not visual styling.

- For Svelte components, test user-visible behavior: callbacks, keyboard interactions, focus/close behavior, state persistence, disabled/destructive flows, sanitized rendering, and registration/lifecycle behavior.
- Do not assert on Tailwind utility strings, daisyUI class names, or visual-only details.
- Add package-boundary tests for public SDK UI exports. The tests should fail if SDK UI imports app renderer internals, IPC, Electron/preload, Rust-sidecar paths, or undocumented package internals.
- For plugin components, use `@openforge-app/plugin-sdk/testing` fakes/mocks for registrations and host-facing calls.
- For domain components, test domain rules in the layer that owns them. For example, task lifecycle actions belong in task-domain tests, not generic `ContextMenu` tests.
- For exact duplicates being deduplicated later, preserve or move the behavior tests before deleting a copy.

## Extraction checklist

Use this checklist before moving a component between layers:

- What layer owns the component today?
- Which layer should own it after the change, and why?
- Does the component import app-private helpers, IPC, stores, or domain types?
- Is the reusable part behavior-bearing or only a class list?
- Are at least two surfaces using the same semantic primitive?
- Can the props/callbacks be stable without exposing app internals?
- Are accessibility requirements built into the primitive?
- Are examples and behavior tests updated for the target layer?
- Would publishing this in the SDK make it hard to change later?

If the answers are unclear, keep the component local and create a focused design/refactor task.

## Follow-up work split out of this task

The audit proves several real follow-ups, but they should remain separate from these guidelines:

- Define and enforce import-boundary checks for app-private versus plugin-safe UI.
- Choose ownership and deduplicate cloned `Card` and `ResizablePanel` components.
- Continue deduplicating plugin-local dialog callers onto the plugin-safe SDK `Modal.svelte` primitive when another repeated shell appears.
- Split large plugin view containers (`PrReviewView.svelte`, `SkillsView.svelte`, `TaskSchedulesView.svelte`, `FilesView.svelte`) into state containers plus presentational sections before extracting generic UI.
- Consolidate plugin page headers and empty/loading/error shells after API convergence is clear.

Keep future tasks focused on one boundary or primitive at a time.
