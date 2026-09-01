## Context

See `proposal.md` for motivation and the three delta specs for required behavior.

The renderer currently stores a binary `ThemeMode`, maps it to two daisyUI theme names, and persists `light` or `dark`. `src/app.css` combines daisyUI theme values with OpenForge-specific status, terminal, Markdown, animation, and layout rules. Several consumers infer appearance by checking whether the active theme name contains `dark`.

The public plugin SDK already ships a small set of Svelte UI components, and the root Vite configuration aliases those imports to SDK source for host use. Adoption is partial. Many host and built-in plugin components still compose controls directly from daisyUI classes and fixed Tailwind radius utilities. External frontend plugins can load package CSS through `frontendStyles`, but those stylesheets remain active for the plugin lifecycle and do not represent selectable themes.

Trusted Plugins are installed code, not sandboxed widgets. The design can permit selected theme CSS while still providing deterministic registration, selection, and cleanup.

## Goals / Non-Goals

**Goals:**

- Put theme selection and fallback behind one small registry interface.
- Make a fixed semantic token set the styling contract shared by the host and plugins.
- Let explicit appearance metadata drive non-CSS renderers and previews.
- Make SDK UI components independent of a plugin author's Tailwind or daisyUI setup.
- Tie plugin themes and theme styles to existing app-level plugin activation generations.
- Migrate shared controls and durable content structures without wrapping ordinary layout markup.

**Non-Goals:**

- Removing Tailwind or daisyUI from the renderer in this change.
- Sharing implementation code with the Astro website.
- Per-project theme selection.
- A theme marketplace or a new plugin installation mechanism.
- Sandboxing Trusted Plugin CSS or guaranteeing accessibility for arbitrary plugin overrides.
- Replacing feature-specific data visualization, diff syntax, terminal ANSI semantics, or plugin-owned branded layouts with generic components.

## Decisions

### Architecture gate: explore the visual system and use Bits UI for interaction behavior

Before executable work starts, run `/opsx-explore add-angular-extensible-theming` as a decision gate. That exploration defines the light and dark visual references, semantic token taxonomy, geometry, typography, motion, and representative component anatomy. It also validates the proposed UI framework through a disposable dialog and select spike across both the host renderer and an external plugin build.

Use Bits UI 2.x as the recommended headless interaction implementation when the spike confirms shared Svelte runtime compatibility, portal behavior, CSS extraction, bundle impact, and required accessibility behavior. Bits UI remains private to the OpenForge UI component implementations. Public component properties, callbacks, errors, tests, and documentation must not expose Bits UI types or require callers to understand its compound component model.

The styling contract remains OpenForge-owned. Bits UI supplies keyboard interaction, focus management, ARIA behavior, controlled state, and portal mechanics. Scoped component CSS and `--of-*` tokens supply appearance. Host and plugin callers continue to import `@openforge-app/plugin-sdk/ui/*`, so replacing the headless dependency later does not require a caller migration.

The gate records its findings and final framework decision in this design before implementation proceeds. If the host and external-plugin spike rejects Bits UI, stop and revise the design and tasks rather than silently choosing another dependency during implementation.

Alternatives considered:

- shadcn-svelte distributes editable Tailwind-heavy source rather than a runtime foundation. Its examples can inform component anatomy, but adopting its generated layer would duplicate the public OpenForge component library.
- Skeleton brings an overlapping theme system and a broad Zag-based component dependency set. Adopting it would make Skeleton's design contract compete with plugin-defined OpenForge themes.
- Melt's Svelte 5 package is still pre-1.0 and permits minor-release breaking changes, which is too volatile behind a published plugin UI contract.
- daisyUI remains useful as a temporary styling adapter, but it does not own the complex interaction behavior required for dialogs, tabs, menus, tooltips, and composite fields.

### 1. Use a typed theme definition and one host-owned registry

Introduce a shared theme contract with a fixed shape similar to:

```ts
type ThemeAppearance = 'light' | 'dark'

type ThemeDefinition = {
  id: string
  label: string
  appearance: ThemeAppearance
  tokens: ThemeTokens
  stylesheets?: string[]
}
```

`ThemeTokens` is a typed, complete record rather than an open string map. It covers canvas and layered backgrounds, primary and secondary text, borders, accent and semantic states, focus, control and container geometry, typography, elevation, motion, code presentation, status presentation, and the terminal palette.

The host registry owns built-in registration, plugin registration, validation, available-theme snapshots, selection, persistence, and fallback. Callers select by id and consume a selected-theme snapshot. They do not set document attributes or configuration directly.

Built-in identifiers remain host-owned. Plugin identifiers use the existing contribution convention, `${pluginId}:${localId}`. A duplicate local id in one activation fails instead of replacing an earlier registration.

Alternatives considered:

- Keep `ThemeMode` and add more CSS selectors. This cannot represent plugin ownership, unavailable themes, or arbitrary stable ids.
- Let plugins mutate `data-theme` directly. This gives the host no way to list, validate, persist, or remove themes.
- Accept an arbitrary token dictionary. This makes compatibility and validation impossible because callers cannot know which values exist.

### 2. Apply semantic tokens at the document root and keep daisyUI as an adapter

The selected theme's token values are written as documented `--of-*` custom properties on the document root. Global CSS maps daisyUI variables such as `--color-base-100`, `--color-primary`, and its radius values to the corresponding OpenForge properties. Existing daisyUI callers therefore move with the theme during migration, while new SDK components consume only `--of-*` properties.

The root also receives the selected stable id and explicit appearance as separate data attributes. Identity and appearance must never be inferred from one another.

Built-in theme values live in typed definitions near the registry rather than being split between TypeScript metadata and independent CSS theme declarations. `src/app.css` retains global adapters, resets, and genuinely global presentation rules. Theme values move out of that file.

Alternatives considered:

- Make daisyUI variables the public theme contract. Their names and component assumptions belong to daisyUI and do not cover terminal, code, ownership, or lifecycle behavior.
- Replace daisyUI immediately. That turns a theme change into an unbounded renderer rewrite and removes the compatibility bridge needed for incremental migration.

### 3. Resolve the saved selection after app-level plugin activation

Startup registers built-in themes first, activates app-level plugins, then resolves the stored theme id against the complete registry before showing the normal application shell. The document starts with the built-in light token defaults so preload and failure states never render unstyled.

Stored `light` and `dark` values are translated once to the new built-in ids and persisted. Any other missing or invalid id falls back to built-in light after plugin activation completes, updates persistence, and records a diagnostic.

If an active theme disappears later, registry removal and fallback happen in one state transition. Consumers see either the previous valid theme or the complete fallback, never a partially cleared token set.

Alternatives considered:

- Fall back before plugins activate. This would discard a valid saved plugin theme on every startup.
- Retain an unavailable id indefinitely. This repeatedly retries a broken selection and makes the settings state disagree with the rendered theme.

### 4. Carry explicit appearance through theme-sensitive packages

Replace name inspection in Mermaid and diff rendering with an explicit appearance input or the root appearance attribute. Terminal runtime input becomes a selected theme presentation snapshot containing appearance and terminal tokens rather than its own duplicate light/dark theme table.

Theme-sensitive packages may retain safe built-in fallback values for non-browser tests and isolated consumers, but the running app passes the selected theme presentation. Theme changes continue through the existing reactive environment so mounted terminal and diff views update without recreation unless a third-party renderer itself requires it.

Alternatives considered:

- Require plugin theme ids to contain `light` or `dark`. Theme identity is user-defined and must not encode behavior through naming conventions.

### 5. Add app-scoped theme registration to the frontend plugin interface

Add a documented `themes` capability and an `openforge.themes.register(...)` frontend interface. Registration is available only when both conditions hold:

1. The package declares `themes` in `openforge.requires`.
2. The package uses app enablement.

The frontend runtime qualifies local ids, validates definitions, records ownership by plugin activation generation, and returns a disposable registration. Runtime cleanup also removes undisposed registrations so plugin failures cannot leak themes.

A plugin theme may name package-relative CSS artifacts in `stylesheets`. The host resolves them through the existing `plugin://` asset mechanism. Theme styles are separate from ordinary `frontendStyles`: the loader attaches them only for the selected theme and removes them on theme switch, unregister, reload, disable, or uninstall.

To avoid a half-applied switch, the host loads candidate stylesheets in an inactive state. It commits the selected id, root tokens, appearance, and stylesheet activation only after every candidate stylesheet loads. A load failure leaves the current valid theme active and attributes the error to the plugin.

Trusted Plugin CSS can override more than semantic tokens. That is the deliberate full-control escape hatch. Documentation must state that arbitrary theme CSS can break layout or accessibility and is reviewed under the existing Trusted Plugin model.

Alternatives considered:

- Treat `frontendStyles` as themes. Those styles have no selection metadata and remain global while the plugin is active.
- Allow project-enabled theme providers. Theme preference is app-global, so project switching would make the selected theme appear and disappear unpredictably.
- Limit plugins to tokens only. Tokens cover normal themes but do not meet the requirement for deliberately custom plugin-provided appearance.

### 6. Use Bits UI behind self-styled, token-driven public components

Expand the canonical SDK UI export manifest rather than add a second renderer-only component library. The host already resolves these exports to source, so host and plugin callers can use the same maintained modules.

Use native elements directly for simple controls such as buttons, text fields, checkboxes, and switches. Use Bits UI behind composite interactions such as selects, tabs, dialogs, anchored menus, and tooltips, where keyboard navigation, focus management, ARIA relationships, controlled state, or portals justify the dependency. The public OpenForge interface hides that implementation choice and does not re-export Bits UI.

All common controls and containers use scoped component CSS and `--of-*` tokens. They do not require the consuming plugin to run Tailwind or include daisyUI. Public variants stay small and semantic, such as primary, secondary, outline, ghost, and danger. Native attributes and `on`-prefixed callbacks pass through where appropriate.

The component set covers shared behavior and durable visual structures. Layout remains caller-owned. This avoids shallow wrappers around every flex row or grid and keeps feature rules out of plugin-safe components.

Existing exports remain compatible. Where an existing component currently relies on daisyUI classes or hand-written composite interaction behavior, migrate its implementation behind the same public interface. Add new export entries through the existing canonical manifest so package exports, source aliases, copied assets, and contract tests stay synchronized.

The plugin SDK owns the compatible Bits UI dependency. External plugin builds bundle the required headless implementation while continuing to externalize the host-shared Svelte runtime. Contract tests must prove a packed SDK component works in an external plugin without bundling a second Svelte instance.

Alternatives considered:

- Reimplement every composite interaction in OpenForge. That keeps dependencies low but leaves OpenForge responsible for subtle focus, keyboard, portal, and ARIA behavior already maintained by a focused headless library.
- Create a new internal design-system package and mirror exports into the SDK. That introduces two ownership locations and makes host and plugin behavior drift.
- Expose Bits UI or renderer-private shared components directly. Either choice makes callers depend on implementation details that OpenForge must be able to replace. Plugins also must not import root `src/**`, whose components may depend on app services or domain types.

### 7. Migrate by behavior cluster, not by file-wide restyling

Build and test each public component before replacing callers. Migrate in bounded clusters:

1. Theme preference and application shell controls.
2. Modal and palette controls.
3. Settings forms and content panels.
4. Task creation, focus board, and task detail controls.
5. Built-in plugin views and settings.

Within each cluster, replace direct daisyUI controls and fixed shape utilities when a public building block owns the same behavior. Keep feature layout utilities and domain-specific status presentation local. A lightweight inventory check should prevent newly migrated areas from reintroducing covered direct control classes without forcing unrelated layout into the SDK.

Behavior tests assert roles, names, callbacks, state, focus, and lifecycle. Theme registry tests assert token snapshots and document state. They do not assert Tailwind or daisyUI class names. Visual checks cover the built-in light and dark theme at representative shell, settings, modal, task, and plugin views.

## Risks / Trade-offs

- [Arbitrary Trusted Plugin theme CSS can make the host unusable] -> Activate it only after successful loading, retain deterministic built-in fallback, identify the owner in settings, and document recovery by disabling the plugin.
- [A full control migration touches many Svelte files] -> Migrate by behavior cluster with focused tests and keep feature layout out of scope.
- [Temporary daisyUI compatibility can hide unmigrated fixed geometry] -> Map daisyUI variables to semantic tokens, inventory explicit radius and control utilities, and remove exceptions as clusters migrate.
- [Public UI additions increase long-term compatibility obligations] -> Keep interfaces semantic and small, derive export registries from one canonical manifest, and test behavior rather than markup.
- [A headless framework can leak into the public plugin contract or duplicate Svelte] -> Keep Bits UI behind OpenForge interfaces, reject exported Bits types in contract checks, externalize only the shared Svelte runtime, and verify a packed external-plugin fixture before migration starts.
- [Plugin activation can delay saved-theme restoration] -> Apply built-in light defaults immediately, resolve the final selection through the existing app initialization gate, and treat plugin activation failure as completion for fallback purposes.
- [Stylesheet load and plugin reload can race] -> Key registrations and stylesheet handles by plugin activation generation and ignore completion from stale generations.
- [Terminal and diff packages currently own light/dark assumptions] -> Pass one selected presentation snapshot and retain isolated fallback values only for tests and package consumers without a host theme context.

## Migration Plan

1. Run the architecture exploration gate, define the visual references, validate Bits UI in host and external-plugin spikes, record the decision, and stop for a planning revision if the candidate fails.
2. Add failing tests for registry validation, persistence migration, unavailable-theme fallback, explicit appearance propagation, and plugin lifecycle behavior.
3. Introduce the typed theme contract, built-in definitions, registry, and initialization gate. Keep daisyUI aliases so existing callers continue to render.
4. Move built-in values out of daisyUI theme declarations, apply the angular light and dark values, and connect settings to registry selection.
5. Update diff, Mermaid, Markdown, and terminal integrations to consume explicit appearance and presentation values.
6. Add the plugin capability, runtime registration, selected stylesheet lifecycle, testing fakes, and package contract coverage.
7. Add Bits UI behind the public composite components, expand and document the SDK UI set, then migrate host and built-in plugin clusters.
8. Run full affected-system checks for the renderer, plugin SDK/runtime, built-in plugins, terminal runtime, PR review UI, package contracts, and Electron IPC or package boundaries touched by the final diff.

Rollback does not require a database migration. Older builds encountering a new qualified theme id will use their existing light fallback behavior. Disabling the new theme contribution path leaves built-in themes available. During implementation, each migration cluster should remain independently revertible while the daisyUI token adapter is present.
