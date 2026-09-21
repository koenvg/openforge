## Why

Terminal programs that query their foreground and background colours can receive Ghostty's unrelated defaults instead of the palette shown by OpenForge. In light themes this makes tools such as Codex select a dark colour scheme, causing coloured output to lose contrast or collapse into nearly uniform text.

## What Changes

- Keep the authoritative terminal model's default foreground, background, cursor, and ANSI palette aligned with the selected OpenForge theme.
- Return those active colours when terminal programs query the terminal, while keeping Ghostty as the sole protocol-response owner.
- Apply theme changes to running sessions without recreating their PTYs or discarding colour overrides set by terminal programs.
- Preserve the same effective palette through terminal recovery, daemon reconnects, and desktop-free session starts, with a deterministic fallback before a saved theme is available.
- Cover startup colour queries, live theme switching, contributed themes, and snapshot restoration with automated tests.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `terminal-session-coordination`: Make the authoritative terminal colour state, protocol replies, and restoration snapshots agree with the active presentation palette across session lifecycle changes.
- `studio-workshop-themes`: Extend theme-aware terminal presentation to terminal programs' colour queries and running terminal sessions, including contributed themes and restart restoration.

## Impact

The change affects the renderer theme adapter, typed desktop IPC, the Rust sidecar and session-daemon contracts, Ghostty terminal-model configuration, portable snapshots, and terminal lifecycle tests. The session protocol changes require coordinated versioning and compatibility coverage. No new external dependency is expected.
