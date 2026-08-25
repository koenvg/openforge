# Keep authoritative terminal state in the Rust sidecar

> Superseded for current production behavior by [ADR 0004](0004-xterm-authoritative-terminal-mode.md). This ADR records a proposed transition direction only.

OpenForge separates each desktop-owned terminal session from its temporary views. This follows Orca's model/view direction, where PTY ingestion and terminal state outlive disposable renderer views, but puts the model in OpenForge's existing Rust sidecar instead of Orca's Electron-side headless xterm. The Terminal Runtime continues to own terminal lifecycle, while the sidecar becomes authoritative for the PTY and parsed terminal state; a view attaches from an atomic snapshot, consumes only later sequenced output, and requests another snapshot after a gap. This keeps sessions alive across renderer failure and keeps the renderer replaceable. We rejected renderer-owned state and an Electron-main headless model because both would duplicate terminal state outside the sidecar.

## Consequences

The sidecar needs a terminal emulation model, snapshot serialization, sequence-aware attachments, and bounded delivery. The migration keeps xterm as the view until these contracts are stable.
