# Stage the Rust sidecar backend crate rename

Status: Accepted
Date: 2026-06-20
Task: KVG-1452

OpenForge will rename the historical `src-tauri` Rust backend location through a staged migration rather than a one-shot path sweep. The target location is `crates/openforge-backend`, while product and runtime language remains **Rust Sidecar**; first make `openforge-backend-layout.json` the source of truth for sidecar, plugin-host, CLI asset, Cargo, and packaging paths, then move the crate once hardcoded `src-tauri` assumptions have been removed.

Considered options: top-level `backend` was rejected because it is too generic in an Electron app where Electron main, preload, local HTTP, plugin host, and Rust all have backend-like responsibilities. `crates/openforge-backend` makes the Rust package boundary explicit and leaves room for future Rust crates.
