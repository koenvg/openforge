## Why

OpenForge's desktop UI still uses a rounded purple theme that no longer matches the angular visual language of the website, while theme behavior is limited to a hard-coded light/dark switch. Styling also lives across daisyUI classes, direct utilities, and component-local rules, so neither the host nor plugins have a stable set of OpenForge building blocks to inherit or customize.

## What Changes

- Replace the current built-in light and dark palettes with an angular OpenForge theme based on the website's neutral canvas, crisp borders, blue accent, restrained elevation, and technical typography.
- Introduce a theme registry and semantic OpenForge token contract for color, typography, geometry, focus, motion, elevation, code presentation, and terminal presentation.
- Persist a selected theme identifier instead of only a light/dark mode, while migrating existing `light` and `dark` preferences and falling back safely when a selected theme is unavailable.
- Add app-level Trusted Plugin theme contributions. A plugin can register discoverable theme metadata and active-theme-scoped styling without making its stylesheet the implicit theme-selection mechanism.
- Expand the public `@openforge-app/plugin-sdk/ui/*` building blocks for common controls, content containers, navigation, and overlays.
- Compose the host renderer and built-in plugin UI from those public building blocks where they own shared interaction or durable visual structure. Tailwind utilities remain available for local layout.
- Preserve an escape hatch for plugins that want a deliberately custom appearance and ship their own frontend CSS.
- Replace theme-name substring checks with explicit light/dark appearance metadata for diff, Markdown diagram, and terminal integrations.

## Capabilities

### New Capabilities
- `application-theming`: Theme discovery, selection, persistence, semantic tokens, built-in angular themes, compatibility migration, and fallback behavior.
- `plugin-theme-contributions`: Registration and lifecycle behavior for themes supplied by app-level Trusted Plugins.
- `openforge-ui-building-blocks`: Public plugin-safe UI components used consistently by the host, built-in plugins, and third-party plugins.

### Modified Capabilities

None.

## Impact

- Renderer theme state and settings under `src/lib/theme.ts` and `src/components/settings/`.
- Global Tailwind and daisyUI integration in `src/app.css`, including current color, radius, terminal, and status tokens.
- Theme-sensitive diff, Mermaid, Markdown, and terminal packages.
- Frontend plugin types, runtime registration, capability metadata, lifecycle handling, tests, and authoring documentation in `packages/plugin-sdk`, `packages/plugin-runtime`, `src/lib/plugin`, and `docs/plugins`.
- Public UI exports and their contract checks in `packages/plugin-sdk`.
- Host and built-in plugin Svelte components that currently use direct daisyUI control or surface classes.
- Stored `theme` configuration remains compatible through migration from existing `light` and `dark` values.
