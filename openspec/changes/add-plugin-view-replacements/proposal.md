## Why

OpenForge plugins can add new pages and small contributions, but users cannot replace the opinionated project dashboard or task workspace with a plugin-built experience. Adding a user-controlled replacement mechanism lets plugin authors offer different workflows without giving plugins ownership of navigation, task state, terminal lifecycles, or recovery.

## What Changes

- Add an SDK contract for plugins to register alternative renderers for named host views.
- Make the project dashboard and task detail workspace the first replaceable host views.
- Let users choose a default renderer globally and override it per project.
- Keep core renderers available as the default and as the automatic fallback when a selected plugin is unavailable or fails.
- Keep routes, navigation history, selected project and task state, terminal and browser resources, plugin management, and recovery owned by OpenForge.
- Add typed task-data change subscriptions so plugin dashboards and task renderers can refresh without polling or importing internal stores.
- Preserve existing plugin View registrations as additive destinations rather than treating every plugin page as a replacement candidate.

## Capabilities

### New Capabilities
- `plugin-view-replacements`: Plugin registration, user selection, rendering, fallback, and live-data behavior for replaceable host views.

### Modified Capabilities

None.

## Impact

- Public plugin SDK types, package capability metadata, exports, testing fakes, and authoring documentation.
- Frontend plugin contribution registration, validation, resolution, activation, and teardown.
- App routing and presentation for the project dashboard and task detail workspace.
- Global and project settings persistence and UI.
- Task data event propagation across the desktop IPC and plugin host boundary.
- Renderer tests, SDK contract tests, plugin lifecycle tests, and cross-boundary validation.
