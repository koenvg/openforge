## Why

Icon-only actions need visible labels so users do not have to guess what an icon means. The SDK already exports Tooltip and IconButton, but IconButton does not automatically provide a tooltip and the current Tooltip owns a separate button trigger.

## What Changes

- Show an automatic tooltip using each SDK IconButton's effective accessible label, with an explicit opt-out.
- Offer the same configuration as an opt-in on SDK Button for controls that alternate between text and icon-only layouts, preserving their native button identity and geometry (user-approved scope extension).
- Allow per-button preferred side, alignment, and spacing, while adjusting placement to avoid viewport clipping.
- Compose the existing SDK tooltip behavior with the existing button rather than nesting interactive elements or introducing a second tooltip implementation.
- Add a subtle overshoot entrance and quick exit, respecting reduced-motion preferences.
- Preserve button activation, accessibility, disabled/loading behavior, styling, and existing standalone Tooltip consumers.
- Audit host and built-in plugin icon-only buttons for adoption and duplicate native title/custom tooltip presentation. Migrate applicable raw icon-only action buttons using existing SDK controls without unrelated UI changes.
- Exclude rich help, links, interactive tooltip content, and new popover features.

## Capabilities

### New Capabilities

- `sdk-icon-button-tooltips`: Automatic icon-button labels, configurable placement, accessible interaction, animation, and host/plugin adoption.

### Modified Capabilities

None. The existing sdk-action-controls specification covers action menus and split buttons rather than icon-button tooltips.

## Impact

- SDK UI components under `packages/plugin-sdk/src/ui/`, their public declarations, tests, and component stories.
- Host and built-in plugin icon-button consumers where positioning or migration is needed.
- Existing Bits UI dependency supplies tooltip interaction and positioning. No new animation dependency is planned.
- No backend, IPC, database, or plugin command changes.
- Coordinate with the active remove-daisyui and add-ui-storybooks changes without expanding their scope.
