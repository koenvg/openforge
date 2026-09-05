## Why

OpenForge UI work currently requires running the desktop application and arranging live data before a page or state can be inspected. Separate page and component Storybooks, backed by deterministic fixtures and checked-in screenshots, will make design iteration and visual review faster and repeatable.

## What Changes

- Add a Pages Storybook containing every application route and every bundled plugin contribution in representative states.
- Add a Components Storybook containing each reusable or visually distinct host, package, and bundled-plugin UI module in its relevant visual states.
- Share production CSS, themes, fixture data, and in-memory runtime adapters between both Storybooks so stories render the real UI without a live Electron backend.
- Add deterministic interaction scenarios for states that cannot be represented by initial props alone.
- Add repository-stored screenshot baselines, comparison tooling, and reviewable image diffs for both Storybooks.
- Add development, static-build, snapshot-check, and intentional snapshot-update commands, with CI validation for both catalogs.

## Capabilities

### New Capabilities
- `ui-storybooks`: Separate page and component Storybooks, deterministic UI scenarios, and repository-managed visual snapshots.

### Modified Capabilities
- None.

## Impact

- Adds Storybook and browser screenshot tooling to the workspace development dependencies.
- Adds two Storybook configurations, shared story fixtures and adapters, stories across the renderer, UI packages, and bundled plugins, and checked-in screenshot baselines.
- Adds workspace scripts and CI checks for static Storybook builds and visual snapshot comparison.
- Does not change production UI behavior or the public Plugin SDK contract.
