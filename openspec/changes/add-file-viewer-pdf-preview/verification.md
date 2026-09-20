# KVG-5075 verification checkpoint

Status: implementation in progress; not ready to mark the complete change finished.

## Delivered scope

Project-only, first-page PDF previews. Task-workspace reads/navigation and page/zoom controls remain assigned to KVG-5077 and KVG-5076 respectively. The broader OpenSpec checklist still contains those later slices; unchecked items may be partially implemented for projects.

The user approved a 15-second read response deadline with cooperative cancellation: stalled OS I/O retains its admission slot until it exits. The two-read limit includes timed-out operations. No claim of forcibly cancelling blocking filesystem I/O is made.

The implementation adds descriptor-relative Unix reads, a shared bounded reader, project identity revalidation, typed app/plugin/SDK adapters, explicit viewer reads, and a first-page PDF.js renderer. Unsupported secure-open platforms fail closed. Existing metadata-only PDF reads are unchanged.

PDF.js is pinned to 6.3.289. All 200 CMap/font/WASM/ICC assets were compared byte-for-byte against the installed release; the license and registered stylesheet are present in the plugin build. The worker is bundled from that same release and instantiated through an explicitly owned Blob module Worker. The repository Node minimum is now 22.13 to match this dependency.

## Passing checks

- Rust: `cargo test`, `cargo check`, `cargo build`, `cargo clippy`, `cargo fmt -- --check`. The principal test binary reported 2,204 passing tests; auxiliary suites also passed. Existing ignored tests were not enabled. Platform exercised: macOS.
- Affected JavaScript suites: `pnpm exec vitest run src/electron src/lib/plugin src/lib/ipc src-tauri/plugin-host packages/plugin-sdk plugins/file-viewer scripts/check-ui-migration-inventory.test.mjs --maxWorkers=2 --exclude '**/*.browser.test.ts'`: 208 files passed, 1 skipped; 1,552 tests passed, 3 expected failures, 1 skipped.
- File Viewer: package `test` with `ARC_CDP_URL=http://127.0.0.1:9222`: 19 files, 107 passing tests. Package `build` and `pnpm exec tsc --noEmit -p plugins/file-viewer/tsconfig.json` passed.
- Plugin SDK: package `test --exclude '**/*.browser.test.ts'`: 70 files, 564 passing tests; `build`, `check:entrypoints`, and `check:contract` passed. The contract check validated clean npm and Bun consumers.
- Root `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm electron:contract:check`, and `pnpm packages:metadata:check` passed.
- Maximum-size HTTP and LF-framed callback tests passed without changing transport limits. Rust adapter tests also cover the maximum document result.
- Repository-wide retry passed with `TMPDIR=/tmp pnpm test --maxWorkers=4 --testTimeout=30000 --hookTimeout=60000 --exclude '**/*.browser.test.ts' --exclude 'src/**/*.browser.test.ts'`: 833 files passed, 10 skipped; 7,134 tests passed, 3 expected failures, 36 skipped, in 242.71 seconds. Log: `/tmp/KVG-5075-root-stable.log`. An earlier sandboxed run reported failures including ENOENT under a removed `.ctx-mode-*` temporary directory and worker-start timeouts; the stable-directory run completed successfully. The PDF browser test also passed separately in Arc (3.78 seconds).

The real-worker browser test connects to a new tab in the existing Arc session through per-tab CDP, not a separately launched browser. It builds a local production bundle and serves a restrictive CSP without unsafe JavaScript evaluation. It covers selectable text, tagged structure, scanned notices, malicious actions, oversized pages, the 2,000-page limit, password-required and corrupt input, worker startup failure, parse/render deadlines, repeated worker/URL cleanup, and failure after rendering. It also mounts the actual FileContentViewer with the built-in light theme, checks the 320-CSS-pixel layout and 200% CSS zoom, and activates return-to-tree with a real Enter key event. The reviewed screenshot is `/tmp/KVG-5075-preview.png` (ephemeral, not a committed visual baseline).

## Gates still open

- Existing browser suites requiring their own Chromium launch were excluded. The new PDF browser test ran separately in Arc.
- The browser harness uses HTTP, not installed Electron's `plugin://` protocol. Installing the plugin into a rebuilt host and checking the real production CSP/protocol remains outstanding. A successful bundle build and CSP unit tests do not replace this check.
- Manual screen-reader reading order, multilingual/complex-font PDFs, pathological compressed-image fixtures, and measured peak memory across full-app open/change/hide/close cycles remain outstanding.
- Linux secure-open runtime coverage and Windows fail-closed runtime coverage have not been exercised.
- Representative Storybook stories and completion of the remaining project portions of the broader checklist are still needed. No page/zoom controls or task-workspace integration should be added to KVG-5075.

No unrelated cleanup was folded into this implementation. KVG-5072 and KVG-5074 remain separate. No commits have been created.
