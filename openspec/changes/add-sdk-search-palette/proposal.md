## Why

Command search, project switching, and the action palette should have the same clear, Raycast-inspired layout. Their shared controls currently live in the app rather than the SDK, so plugins cannot reuse the complete experience and each dialog can drift visually.

## What Changes

- Add a public SDK search palette with a spacious search field, optional result groups, leading icons, trailing metadata, inset selection highlighting, and a fixed footer.
- Migrate command search, the project switcher, and the action palette to that shared component while preserving their filtering, ordering, selection, execution, confirmation, and dismissal behavior.
- Preserve each palette's current footer information and shortcuts, including action confirmation states. Do not add a secondary Actions menu.
- Use OpenForge theme tokens for the default appearance and document stable palette styling hooks for plugin theme stylesheets. Themes may opt into translucent backgrounds and backdrop blur; neither is required by the default design.
- Publish component documentation, theme customization examples, and representative component stories.

## Capabilities

### New Capabilities

- `sdk-search-palette`: A reusable, accessible, themeable SDK search palette and its adoption by the three host palettes.

### Modified Capabilities

None. Existing theme loading and selection requirements remain unchanged; this component consumes that contract.

## Impact

- SDK UI component, public entrypoint and declaration registries, packaged assets, contract tests, documentation, and stories.
- App components `CommandPalette.svelte`, `ProjectSwitcherModal.svelte`, and `ActionPalette.svelte`, plus their existing app-local palette controls and keyboard navigation dependency.
- Theme stylesheet integration tests and visual verification for default and customized appearances.
- No new package dependency, IPC command, backend change, native window transparency feature, or theme manifest breaking change is planned.
- Coordinate with the active `remove-daisyui`, `add-angular-extensible-theming`, and `add-ui-storybooks` changes where their files overlap. Do not absorb those changes.
- Task-loading error recovery remains separate in cleanup task KVG-4979, dependent on KVG-4977.
- Owner-approved follow-up KVG-4988 owns file quick-open, inline prompt completion, and eventual removal of the legacy app palette controls. Keep those controls and consumers unchanged in this change.
