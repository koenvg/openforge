# Verification

## Delivered behavior

- Pull request findings and follow-up questions now render from scope-bound Review Threads, including live updates, replies, reviewer status, awaiting state, unread answers, step anchors, and orphaned line anchors.
- A successful GitHub review includes each resolved agent-authored inline finding once, then dismisses exactly the submitted Review Threads.
- The hidden headless review generator, printed-output schemas and parsers, adapter records, obsolete stores, private host commands, and unscoped generation identity are removed.
- Versioned walkthrough records and the one-release legacy walkthrough decoder remain supported.

## Breaking local-data change

Existing locally stored AI review comments and question threads are intentionally not migrated and no longer appear after upgrade. The retired `pr-ai-review:*`, `pr-ai-threads:*`, and `pr-review-session:*` values are not read, written, imported, or proactively deleted. Jira and walkthrough storage remain intact.

## Passing checks

- GitHub Sync plugin: 38 files and 435 tests passed; typecheck and production frontend/backend bundle passed.
- The final focused Review Thread regression run passed 2 files and 15 tests, covering both the shared diff UI and the app self-review surface.
- Workspace packages: SDK 75 files and 633 tests passed with 3 expected failures; terminal runtime 56 files and 274 tests passed with 1 existing skip. Package builds and the packed SDK contract passed.
- The final repository-wide run passed 827 files and 7,117 tests with 3 expected failures and 35 existing skips; its only failure was the load-sensitive browser timeout recorded below. That browser file passed all 12 tests when rerun alone. TypeScript and lint passed.
- Electron contract generation/check and macOS production packaging passed.
- Rust: 2,193 unit tests and 5 integration tests passed. Clippy with all targets/features and warnings denied, formatting, and compilation passed.
- `git diff --check` passed.
- Built GitHub Sync and SDK artifacts contain none of the retired keys, methods, headless commands, parser names, or output-schema flag.
- `openspec validate add-pr-review-agent-session --strict` passed.

## Validation gaps

- The repository-wide test command did not finish fully green: `AnchoredMenu.browser.test.ts` timed out at its 30-second limit under the full-suite load. Its isolated rerun passed all 12 tests in 12 seconds, and the complete SDK package suite had also passed earlier. No code in that component changed for this ticket.
- Rust tests requiring separately built Session Daemon binaries or explicit live-provider credentials remained ignored by their existing configuration.
- Packaging was exercised on macOS only; other platform packages were not built in this environment.
- The optional packaged-app smoke launch is not counted as passing. The package built successfully, but the smoke app copied this machine's existing production database into its temporary directory and timed out while recovering stale managed-process records. A second smoke attempt was stopped because its macOS process-group cleanup also terminated the invoking tool process.
- Ticket coverage remains an unresolved planning gap. The design says to preserve the structured coverage panel, but the scoped CLI walkthrough contract authorizes only step submissions and Review Thread writes, and the versioned record defines no typed coverage submission. Removing final-output parsing therefore leaves the panel's structured coverage result empty. Preserving it requires a separately designed typed producer, while adding another hidden command here would contradict the exact-command authorization requirement.
