# Use libghostty-vt for the sidecar terminal model

> Superseded for current production behavior by [ADR 0004](0004-xterm-authoritative-terminal-mode.md). Ghostty remains diagnostic until the transition gates pass.

OpenForge will use `libghostty-vt` behind an OpenForge-owned terminal-model interface instead of introducing another emulator before a later Ghostty migration. This keeps the authoritative sidecar model aligned with the intended renderer while insulating OpenForge from the pre-1.0 community Rust binding and Ghostty C API.

## Consequences

OpenForge must pin the Rust binding and Ghostty source revision, supply Zig 0.16 in development and release builds, prohibit network access during builds, and verify macOS, Linux, and Windows packaging. The first implementation runs `libghostty-vt` in shadow mode while xterm remains authoritative. Compatibility fixtures for supported agents, shells, full-screen TUIs, Unicode, links, images, resize behavior, and protocol replies must pass before terminal-state authority moves to the sidecar.
