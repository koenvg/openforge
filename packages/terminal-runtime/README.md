# @openforge-app/terminal-runtime

Host-shared terminal lifecycle runtime for OpenForge trusted plugins that render terminal surfaces.

This package is MIT-licensed so plugin authors can build and redistribute terminal surface integrations against the public OpenForge host runtime contract. It must only compose public plugin capabilities; it must not import OpenForge renderer stores, Electron/preload internals, Rust sidecar helpers, or other private app modules.

## Renderer conformance

`TerminalView` exposes semantic presentation capture and renderer-frame drain evidence for conformance tests and benchmarks. See [`conformance/README.md`](conformance/README.md) for the shared KVG-3903 recording corpus, interaction matrix, visual bounds, and memory metrics.
