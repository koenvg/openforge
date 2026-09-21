## 1. Terminal Colour Contracts

- [x] 1.1 Add failing renderer tests for resolving built-in and contributed terminal tokens, CSS variables and functions, alpha composition, complete-profile rejection, and the OpenForge Light fallback; implement the normalized opaque sRGB profile adapter and verify with `pnpm exec vitest run src/lib/terminalThemePresentation.test.ts`.
- [x] 1.2 Add failing Rust tests for RGB bounds, serde camelCase names, the built-in light fallback, and xterm-compatible 16-colour plus cube and grayscale expansion; implement the shared native profile types and verify with `cargo test -p openforge-session-host terminal_color_profile` from `src-tauri`.
- [x] 1.3 Add the typed `src/lib/ipc.ts` terminal-profile wrapper, sidecar payload decoder, and generated desktop-command registry contract; update valid and invalid payload fixtures and verify with `pnpm exec vitest run src/lib/ipc.test.ts` and `pnpm electron:contract:check`.

## 2. Ghostty Authority Behavior

- [x] 2.1 Add failing terminal-model tests that batch OSC 10, 11, 12, and OSC 4 queries at startup and expect exactly one profile-derived reply per query; install the profile in `TerminalModelOptions` before any child output and verify with the focused `cargo test -p openforge terminal_model` suite from `src-tauri`.
- [x] 2.2 Add failing actor tests for a live profile update ordered against PTY output, preservation and reset of program OSC overrides, bounded-queue behavior, and update failure; implement the actor command without a second model mutation path and verify with the focused `cargo test -p openforge terminal_model` suite from `src-tauri`.
- [x] 2.3 Add failing recovery tests for selected defaults, all 256 palette entries, program overrides, parser continuation, and old checkpoints with no profile; update portable snapshots and model checkpoints, then verify with `cargo test -p openforge terminal_model::checkpoint` from `src-tauri`.

## 3. Session Daemon and Sidecar State

- [x] 3.1 Add failing session-protocol and host-ledger tests for the versioned installation profile command, validation, idempotent retry, operation conflicts, stale controllers, and protocol-version rejection; implement the command and client API, then verify with `cargo test -p openforge-session-protocol` and `cargo test -p openforge-session-host` from `src-tauri`.
- [x] 3.2 Add failing daemon tests proving that the accepted profile initializes later spawns, updates every live model without changing PTY identity, survives executable replacement, and defaults old checkpoints safely; implement backend storage, actor fan-out, and checkpoint handling, then verify with `cargo test -p openforge-session-daemon` from `src-tauri`.
- [x] 3.3 Add failing sidecar integration tests for durable profile storage, corrupt or absent fallback data, daemon reconnect reconciliation before spawn, desktop-free agent and shell starts, and the isolated legacy manager path; implement the typed app command and shared manager state, then verify with the focused `cargo test -p openforge app_invoke` and `cargo test -p openforge pty_manager` suites from `src-tauri`.

## 4. Theme Lifecycle Integration

- [x] 4.1 Add failing theme lifecycle tests showing that stylesheet activation precedes RGB resolution, profile publication is serialized with selection, contributed-theme removal republishes the fallback, and an unresolvable profile uses the existing unavailable-theme fallback; wire publication into the theme commit and verify with `pnpm exec vitest run src/lib/themeRegistry.test.ts src/lib/themeStylesheetLifecycle.test.ts src/lib/plugin/pluginRegistry.themeLifecycle.test.ts`.
- [x] 4.2 Add failing Terminal Runtime and xterm tests showing that each view receives the same normalized core colours as the published authority profile, live theme changes keep the attachment and session, program overrides survive, and xterm-generated OSC replies remain discarded; implement propagation and verify with `pnpm --filter @openforge-app/terminal-runtime test`.
- [x] 4.3 Add a desktop integration test that changes between light, dark, and contributed profiles while a session remains live, then asserts stable Shell Session Key and PTY instance plus matching query replies before and after recovery; verify with the focused root Vitest file and its Rust app-invoke counterpart.

## 5. Conformance and Documentation

- [x] 5.1 Add a real PTY-shaped conformance probe that reproduces Codex-style batched startup colour queries under a light theme and verifies distinct readable colours, one authority reply per query, live switching, and snapshot recovery; verify with `pnpm terminal:presentation` and the focused Rust terminal protocol test.
- [x] 5.2 Update `docs/terminal-state-and-response-paths.md`, the Ghostty authority ADR, and terminal renderer documentation to describe profile ownership, normalization, fallback, update ordering, and recovery; verify their references and terminology against the implemented contracts.

## 6. Affected-System Validation

- [x] 6.1 Run frontend and package validation with `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm packages:test`, `pnpm packages:build`, `pnpm electron:contract:check`, and `pnpm terminal:presentation`; fix any failures caused by this change and record unrelated failures.
- [x] 6.2 Run native and cross-boundary validation from `src-tauri` with `cargo test --workspace`, `cargo check --workspace`, and `cargo clippy --workspace --all-targets -- -D warnings`; fix any failures caused by this change and record environmental or unrelated gaps.
