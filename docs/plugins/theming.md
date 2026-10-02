# Application themes

App-enabled Trusted Plugins can add selectable themes without replacing OpenForge's settings or writing theme preferences themselves. Token-only themes are the default choice. Selected stylesheets are an optional escape hatch.

## Package and registration

Use SDK 0.3.0 or newer with a host that supports `themes`. API version remains `1`. Declare a frontend entry, `"enablement": "app"`, and both `"appEnablement"` and `"themes"` in `openforge.requires`. Project-enabled plugins cannot register application themes. Installing a package does not enable it.

The [complete, installable example](../../src/lib/plugin/fixtures/selected-theme/README.md) includes package metadata, a standalone token palette, a frontend entry, and selected CSS. Its registration uses only public SDK imports:

```js
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import tokens from './tokens.js'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.themes.register({
      id: 'paper',
      label: 'Paper',
      appearance: 'light',
      tokens,
      // Omit this property for a token-only theme.
      stylesheets: ['./paper.css', './accents.css'],
    }))
  },
})
```

Here `tokens.js`, `paper.css`, and `accents.css` are the files in that example, not SDK exports. Ship every referenced file. A token-only variant needs only the frontend entry and token file; remove the `stylesheets` property, and remove unused CSS entries from the package's `files` list. Ordinary view CSS is optional too.

The host qualifies a local ID as `${pluginId}:${id}`. Keep local IDs stable across releases and do not pre-qualify them. A duplicate local ID in one activation fails instead of replacing the first theme. Settings displays the plugin owner. Registration returns a disposable; add it to `context.subscriptions`. The host also removes contributions at the end of their activation generation.

## Complete token contract

Import `ThemeTokens`, `ThemeTokenName`, `ThemeAppearance`, `PluginThemeDefinition`, `THEME_TOKEN_NAMES`, `THEME_TOKEN_CSS_PROPERTIES`, and `validateThemeDefinition` from `@openforge-app/plugin-sdk`. The [canonical token list](../../packages/plugin-sdk/src/themes.ts) names every required key, and the [example palette](../../src/lib/plugin/fixtures/selected-theme/tokens.js) supplies concrete values for all of them. Use `satisfies ThemeTokens` in TypeScript rather than casting a partial record.

Every required token must contain a nonempty CSS value appropriate to its role. There is no implicit inheritance from a built-in theme. The contract covers:

| Group | Values to supply |
| --- | --- |
| Colors | Canvas and surfaces, text and icons, borders and focus, accent and semantic feedback, controls and fields, task statuses, code and diff colors. |
| Terminal | Background, foreground, cursor and cursor accent, selection background and foreground, all sixteen ANSI colors. Keys start with `terminal`. |
| Geometry and spacing | Border and focus widths, control/container/overlay/shell/round radii, compact/normal/touch control heights, `space1` through `space9`. |
| Typography | Sans and mono font families, five text sizes and line heights, regular/medium/semibold weights. |
| Elevation and motion | Surface/raised/overlay shadows, four durations, standard/enter/exit easing. |

Use concrete, self-contained values. A `var(...)` reference can pass syntax validation yet resolve to nothing or form a cycle in a browser. Validation does not prove contrast, font availability, CSS variable resolution, or usability. Unknown token keys are not customization points; the host copies only the canonical keys.

The document adapter maps camelCase token names to kebab-case CSS properties, such as `surfaceRaised` to `--of-surface-raised` and `terminalBrightBlue` to `--of-terminal-bright-blue`. Use `THEME_TOKEN_CSS_PROPERTIES` when tooling needs that mapping. Do not depend on daisyUI variables or private component selectors as a public theme API.

Appearance is explicitly `light` or `dark`. It drives Mermaid, diff, and terminal presentation independently of the identifier. A dark theme can be named `ink`; a light theme can contain `dark` in its ID. Do not infer appearance from a name. Plugins must not write root theme attributes or host configuration directly.

## Selected CSS versus view CSS

`stylesheets` belongs to the registered definition. Its paths are relative to the package root and must end in `.css`. `./paper.css` and `dist/paper.css` are valid. Absolute paths, traversal, URLs, percent escapes, backslashes, queries, and fragments are invalid. The host resolves assets through `plugin://`; authors should not construct those URLs themselves.

The host loads candidate files with inactive media, then commits the selected ID, tokens, appearance, and CSS only after every file loads. A load error or 15-second timeout retains the previous valid theme and identifies the plugin. Switching selection cancels pending files. Switching away, unregistering, reloading, disabling, or uninstalling removes the old generation's selected CSS.

`openforge.frontendStyles` instead declares extracted Svelte/view CSS that stays loaded for the plugin's activation. Never put selected-theme CSS there, or import it from your frontend entry where a bundler could merge it into ordinary view CSS. Copy selected stylesheets as separate artifacts and include them in the package. A custom plugin view may use its own scoped CSS without registering an application theme.

## Persistence, reload, and fallback

OpenForge persists the qualified selection and restores it after app-level plugins finish activating. Existing `light` and `dark` preferences migrate to `openforge-light` and `openforge-dark`. An unavailable saved or active contribution falls back to `openforge-light`, persists that choice, and reports the unavailable ID.

Successful plugin reload replaces the old generation and restores its selected theme unless the user selected something else meanwhile. Failed reload or removal of the selected contribution leaves built-in light available. A candidate stylesheet failure while switching is different: the current valid theme stays selected.

## Trusted Plugin risks and recovery

Theme CSS is not sandboxed. It can hide settings, cover controls, remove focus indicators, reduce contrast, trigger motion, or otherwise make the app unusable. Successful loading does not mean the stylesheet is safe. The capability declaration documents intent and gates registration; it is not an OS or CSS security boundary. Review the plugin's code and assets before enabling it.

If settings remains usable, select **OpenForge Light**, then disable the owning plugin in Global Settings. If CSS obscures settings, use the installed CLI from a separate terminal:

```sh
openforge plugin app disable --plugin-id selected-theme-fixture
```

Replace the ID with the owner shown in settings or the installed package metadata. This requires the running app's local bridge. Disabling removes its selected CSS and contributions and falls back to built-in light. Restart and verify the fallback persists. If the bridge or app cannot start, this live recovery command cannot help; preserve the error and use the normal application support/recovery process. Do not edit the database or plugin storage as a theme-authoring workaround.

Fix the package, rebuild its artifacts if needed, and reinstall the corrected local package before enabling it again. `openforge plugin reload --plugin-id selected-theme-fixture` reloads installed artifacts; it does not rebuild source or recopy edits from the original source directory.

## UI imports and testing

Use the documented [SDK UI subpaths](./sdk-reference.md#ui-component-exports). Components consume the active `--of-*` values and do not require Tailwind or daisyUI in the plugin. Externalize the host-shared Svelte runtime using the [SDK Vite helpers](./sdk-reference.md#vitebuild-exports). Declare emitted component CSS in `frontendStyles`. Never import renderer-private `src/**`, SDK implementation paths, or private headless types.

The host no longer ships daisyUI classes or compatibility variables. Undocumented classes such as `btn`, `loading`, `alert`, and `bg-base-100` are not a plugin styling API. Existing SDK exports, theme IDs, `--of-*` tokens, and plugin-owned CSS remain supported.

Host-compiled views can use semantic utilities such as `bg-of-surface`, `text-of-text`, `border-of-border/50`, and `hover:bg-of-accent/10`. These utilities preserve color opacity without changing child opacity. A standalone plugin Tailwind build must define its own compilation setup, or use direct tokens. Public SDK controls need neither host utility CSS nor Tailwind. Use the documented `LoadingIndicator`, `Alert`, and `Progress` imports for feedback, and publish emitted component CSS through `frontendStyles`.

See [removal evidence and rollback](../daisyui-removal-validation.md).

The [testing guide](./testing.md#testing-application-themes) separates registration checks from actual Electron checks. The [release validation record](./theming-release-validation.md) records what was run for this release, including gaps. Do not treat a passing fake or jsdom load event as proof that CSS paints correctly in Electron.
