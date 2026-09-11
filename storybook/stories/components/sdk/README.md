# Plugin SDK basic controls

KVG-4691 owns these production controls in the component catalog. The shared `SettingsFrame` supplies the host spacing and settings card; the catalog preview supplies production CSS, fonts, themes, and the deterministic environment. No fixture imports the application root.

| Stories | Inventory ownership | States |
| --- | --- | --- |
| Actions | Button, IconButton, internal ButtonControl | Variants, sizes, disabled, caller-composed busy action, narrow overflow, keyboard activation |
| Fields | TextField, Textarea, Checkbox, Switch | Empty, selected, disabled, validation, mixed checkboxes, input adornments, narrow overflow, keyboard edits |
| Selectors | Select, SearchableSelect | Placeholder, selected, disabled controls/options, validation, open popup, empty results, filtering, overflow, 5,000 options with 40 visible results, keyword-only search, keyboard selection/dismissal |
| Presentation | Badge, StatusBadge, Panel, FileTypeIcon | All badge variants, all StatusBadge states, panel slots/padding, representative file types and fallback, open/closed folders, narrow overflow |
| Navigation | PluginSidebarLink | Inactive, current page, collapsed, long label, keyboard activation |

KVG-4692 owns the composite exports: Modal, AnchoredMenu, Tabs, Tooltip, MarkdownContent, ProjectFileTree, ResizablePanel, PluginPageHeader, PluginPageShell, PluginViewState, and CollapsibleSection. No new page contribution belongs to this slice. The original Button primary story and baseline remain valid.

Only supported states are shown. Button has no loading prop, so its busy example uses caller content with native `disabled` and `aria-busy`. SearchableSelect supports disabled state but has no loading/error props. Badges, file icons, and panels have no selection or loading behavior. Do not simulate unsupported props in fixtures.

## Checks

```sh
pnpm exec vitest run storybook scripts/storybook-coverage scripts/storybook-visual packages/plugin-sdk
pnpm exec tsc --noEmit -p storybook/tsconfig.json
pnpm storybook:build
node storybook/stories/components/sdk/check.mjs
pnpm storybook:coverage
pnpm storybook:visual:update
pnpm storybook:visual:check
```

The browser check reads the built component index, runs every SDK story and its play function, repeats keyboard interactions, and forces a same-document remount after editing a field and both storage areas. It rejects failed plays, page errors, and console diagnostics. The sole warning exception is Storybook 10's exact legacy Story Store deprecation message during repeated instrumentation. External requests are blocked. It does not replace canonical screenshot checks.

The visual manifest covers design-significant states without multiplying every variant by every theme and viewport. Default groups and constrained layouts cover light and dark themes. Interactive readiness selectors identify the opened popup or finished interaction; the no-results story marks readiness only after typing the complete query. New baselines must come from the pinned Linux runner described in `docs/storybook-visuals.md`, not native browser screenshots.

The keyboard-focus action snapshot permits at most eight changed pixels, each differing by one channel level. This bound comes from consecutive pinned Linux captures of antialiased button borders. Every other new SDK snapshot uses exact comparison. The browser check also verifies that the searchable popup and the final folder examples are not clipped.

## SearchableSelect behavior

KVG-4885 adds disabled state, bounded results, caller keywords, and accessible result counts. The keyboard stories verify trigger focus after selection and Escape. `BoundedResults` keeps the selected label outside the first 40 of 5,000 options; `KeywordSearch` finds a project by its ID, selects it, and reopens the filtered list.
