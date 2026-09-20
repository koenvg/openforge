# KVG-5077 verification checkpoint

Status: task-workspace implementation and affected-system checks complete, with the known Rust test isolation failure and manual/platform gaps listed below. This does not complete KVG-5076 or the entire OpenSpec change.

## Delivered task-workspace scope

- Authenticated `task_fs_read_document` and `openforge.fs.task.readDocument` resolve only live host task/workspace records. Caller roots and snake_case identities are rejected; missing workspaces never fall back to project files. Metadata-only reads remain unchanged.
- Project/task reads share the existing two-read admission limit, 15-second response deadline, descriptor-relative symlink-denying reader, 16,777,216-byte limit, and bounded response contract. Timed-out blocking I/O retains its permit until exit.
- Revalidation covers task/project/workspace records and the opened root's device/inode before publication. Replacing a directory at the same pathname cannot publish bytes from the old root.
- Public task SDK, frontend/backend adapters, typed desktop IPC, generated registry, unavailable-host behavior, and explicit document fixtures are wired end to end. Both transports round-trip the exact maximum base64 payload with byte equality.
- Task File Viewer reuses the shared first-page renderer. Task changes invalidate its document identity; delayed reads, hidden panes, retries, plugin deactivation, and destruction release owned resources and reject stale results. No page/zoom controls were added.
- Packaged-host testing exposed Electron's wrapped document errors. A failing regression preceded the category-extraction fix; UI messages remain sanitized and project-specific copy is unchanged.

## Test-first evidence

- The initial authenticated task command test failed with the expected unimplemented-command response before routing existed.
- The root-replacement regression initially returned old bytes from a replaced workspace directory; the descriptor-backed root guard made it pass.
- Task SDK/workspace routing and task PDF dispatch tests failed before those capabilities were wired.
- The wrapped-error regression failed with the generic renderer message before the stable document category was recognized.

## Affected-system verification

Commands ran with `TMPDIR=/tmp`; Arc-backed PDF tests used `ARC_CDP_URL=http://127.0.0.1:9222`.

- Root: `pnpm test --maxWorkers=2 --testTimeout=30000`: 844 files passed, 9 skipped; 7,186 tests passed, 3 expected failures, 35 skipped. An earlier four-worker run hit seven five-second timeouts; all affected tests passed at the original timeout with one worker before the successful full retry.
- File Viewer: `pnpm --filter @openforge-app/plugin-file-viewer test --maxWorkers=2`: 20 files / 113 tests passed, including both real project/task Arc PDF cases. Package build and package TypeScript check passed.
- Plugin SDK: package tests passed 635 tests / 76 files, with 3 expected failures; package build, `check:entrypoints`, and `check:contract` passed.
- Root TypeScript, lint, `electron:contract:check`, and `packages:metadata:check` passed. Root tests include Electron transport/policy, app/frontend runtime, and backend plugin-host tests.
- Rust: the unfiltered suite hit the pre-existing `pty_manager::attachment_tests::attachment_writes_only_valid_utf8_to_the_bound_agent_pty` isolation failure involving preserved `~/.openforge/pids-dev/interactive-agent-pty.pid` metadata. Existing KVG-5123 tracks it; recovery data was not removed.
- Rust retry: `cargo test -- --skip pty_manager::attachment_tests::attachment_writes_only_valid_utf8_to_the_bound_agent_pty` passed 2,263 principal tests (17 ignored, 1 filtered), plus auxiliary suites. `cargo check`, `cargo build`, `cargo clippy --all-targets -- -D warnings`, and `cargo fmt -- --check` passed.
- `pnpm build:plugins`, `pnpm build`, and `pnpm electron:build` passed. No canonical visual baseline changed; the existing project PDF story copy/readiness remains unchanged.

Logs are local `/tmp/KVG-5077-*-final.log`, `/tmp/KVG-5077-cargo-*.log`, and `/tmp/KVG-5077-timeout-recheck.log`.

## Packaged Electron evidence

Built `/tmp/KVG-5077-PDF.app` with production renderer/Electron bundles and the current **debug** Rust sidecar, then installed the freshly built File Viewer into isolated app-data/user-data directories. The regular installed app and user workspaces were untouched.

A CDP-driven smoke mounted the exported task component using the packaged host's `plugin://com.openforge.file-viewer/dist/frontend.js` and authenticated desktop command transport. It used real temporary host task/workspace records, a two-page tagged/malicious-action PDF, and a different same-name project PDF. This is an isolated component smoke inside the packaged shell, not a claim of full task-tab navigation or signed release testing.

Verified live-task byte equality, traversal rejection, real Blob worker creation under production CSP, selectable text, tagged structure, bounded canvas dimensions, Enter-key return to the selected tree entry, five hide/show cycles, and missing-workspace invalidation without project fallback. No document-action request or page error occurred. Six workers were created, at most one was active, and the final live worker/blob-URL counts were both zero. Event subscription disposal was also checked.

The final run sampled a peak **765,840 KiB** RSS across the isolated Electron process tree at 500 ms intervals. This includes startup and non-PDF app processes, is not baseline-subtracted, and does not establish a PDF memory ceiling or pathological-input memory bound.

Local evidence (ephemeral): `/tmp/KVG-5077-packaged-pdf.mjs`, `/tmp/KVG-5077-packaged-result.json`, `/tmp/KVG-5077-packaged-app.log`, and reviewed screenshot `/tmp/KVG-5077-packaged-task.png`. The Arc cases separately cover narrow layout/200% CSS zoom, scanned/password/corrupt fixtures, budgets/deadlines, and cleanup using the same task/project workspace adapters.

## Remaining coverage and scope

- Linux secure-open execution and Windows fail-closed execution were not run; macOS was exercised.
- Manual screen-reader reading order/announcements, multilingual/complex-font PDFs, and pathological compressed-image memory profiling remain unverified.
- The packaged check used an isolated debug-sidecar app and direct component mount. Signed/release distribution, normal task-tab navigation, and full-app task-switch memory profiling remain gaps.
- Existing ignored/skipped suites were not enabled. Canonical Linux visual screenshots were not regenerated; no baseline-affecting project layout/copy change was retained.
- Page navigation/zoom remains KVG-5076. Broader incomplete OpenSpec items stay unchecked. KVG-5072/KVG-5074 remain separate; the discovered PTY isolation issue already has KVG-5123, so no duplicate cleanup task was created.

---

# KVG-5075 verification checkpoint

Status: implementation in progress; not ready to mark the complete change finished.

## Delivered scope

Project-only, first-page PDF previews. Task-workspace reads/navigation and page/zoom controls remain assigned to KVG-5077 and KVG-5076 respectively. The broader OpenSpec checklist still contains those later slices; unchecked items may be partially implemented for projects.

The user approved a 15-second read response deadline with cooperative cancellation: stalled OS I/O retains its admission slot until it exits. The two-read limit includes timed-out operations. No claim of forcibly cancelling blocking filesystem I/O is made.

The implementation adds descriptor-relative Unix reads, a shared bounded reader, project identity revalidation, typed app/plugin/SDK adapters, explicit viewer reads, and a first-page PDF.js renderer. Unsupported secure-open platforms fail closed. Existing metadata-only PDF reads are unchanged.

PDF.js is pinned to 6.3.289. All 200 CMap/font/WASM/ICC assets were compared byte-for-byte against the installed release; the license and registered stylesheet are present in the plugin build. The worker is bundled from that same release and instantiated through an explicitly owned Blob module Worker. The repository Node minimum is now 22.13 to match this dependency.

## PR #2537 CI fixes

- Merged current `main` and updated the PDF metadata regression to the new root-plus-relative-path `read_file_preview` signature. Strict Clippy also required replacing three `err().expect()` assertions with `expect_err()`.
- Restricted header wrapping to PDFs, restoring every non-PDF visual baseline. Updated the PDF story readiness contract and its single reviewed canonical baseline for the new missing-document/Retry state; the fixture intentionally provides metadata without document bytes.
- After these fixes: 2,241 main Rust tests passed; `cargo clippy --all-targets -- -D warnings` passed; root tests passed 7,136 tests across 833 files (same browser exclusions, 36 skipped and 3 expected failures); File Viewer tests/build, TypeScript, lint, and all 470 canonical Linux visual cases passed.
- Android CI failed on Maven Central HTTP 429 while downloading Kotlin artifacts. A job rerun passed without dependency or build configuration changes.

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
