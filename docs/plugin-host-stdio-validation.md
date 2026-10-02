# Plugin-host stdio callback investigation

KVG-5304 investigated the maximum-size task document callback timeout reported by KVG-5206. The change is limited to LF frame assembly in the TypeScript plugin host and public-boundary regression coverage. It does not enable updates or waive KVG-5206's validation requirements.

## Baseline and reproduction

The starting commit was `b13f0f151e8be20ef1f17bf5d1ce33cfc50a94d7`. Compared with the reported checkpoint `138b60722`, `stdio-transport.ts` was unchanged. The maximum-size tests were also unchanged; the only test-file drift was an unrelated callback example moving from `openforge.tasks.get` to `openforge.tasks.detail`.

The original KVG-5206 worktree and its two supplied logs were no longer present. This investigation could not re-read those logs or attribute their exact 5,637ms observation to a particular scheduling event.

Before implementation:

- The unchanged focused stdio suite passed all seven tests. The project and task maximum-size callbacks took 860ms and 582ms.
- An unchanged normally parallel root run with verbose and hanging-process reporters reproduced the task callback timeout at 5,645ms against its existing 5,000ms deadline. The project case passed at 4,522ms. An unrelated idle-resource-sampler test also timed out.
- That root baseline has no final suite aggregate or controller exit record. After the background execution ended, no process held its owned log. Its overall outcome is unknown, not a successful validation or an established 600s timeout.
- A separate public-boundary probe delivered the same 16 MiB document through `readJsonLines()` and `StdioHostCallbackBridge` in scheduled chunks. Every case emitted exactly one frame and recovered all document bytes.

## Established defect

The old reader appended each chunk to the unfinished frame and searched the entire accumulated string for LF. A frame spanning many chunks repeatedly scanned and flattened its growing prefix. Smaller transport chunks increased the work even when the message, callback routing, and recovered bytes stayed identical.

The replacement searches each incoming chunk once, retains fragments, and joins them when an LF arrives. UTF-8 decoding still belongs to the readable stream. CRLF handling, unescaped Unicode line separators, empty frames, ordered frames, and an unterminated EOF tail retain their existing behavior. There is no protocol, deadline, parallelism, or maximum-document-size change.

The probe used Node 24.14.0, a `PassThrough`, one event-loop yield per chunk, and a 22,369,703-byte JSON-RPC frame containing 22,369,624 base64 characters. These are individual diagnostic measurements, not a stable performance budget. Transport time includes callback parsing and scheduling, but excludes fixture construction and final byte verification.

| Chunk size | Chunks | Before transport time | After transport time |
| --- | ---: | ---: | ---: |
| 64 KiB | 342 | 2,370ms | 77ms |
| 16 KiB | 1,366 | 11,972ms | 95ms |
| 4 KiB | 5,462 | 89,166ms | 390ms |

This establishes the buffering defect and reproduces the reported class of timeout. It does not establish which scheduling circumstances produced the historical observation, or explain the root run's other timing variation.

## Regression and validation

The new regression uses the existing public readable-stream and callback-bridge boundary, not private parser state. It delivers a maximum-size task document in scheduled 4 KiB chunks, immediately followed by another callback response. It asserts exact response order, document status and size, full decoded byte equality, and the following callback's result. Fixture teardown destroys the owned stream and cancels any pending callbacks, including after a test timeout.

The regression failed before the transport change at 5,017ms against the existing 5,000ms deadline. After the change it passed in 231ms in the focused run and 206ms in the complete plugin-host run. Additional boundary cases cover byte-split UTF-8, CRLF split across chunks, empty lines, multiple coalesced frames, EOF tails, and empty input. Both original maximum-size project/task cases remain intact.

Validation ran serially, without other validation jobs overlapping the recorded post-fix root run:

| Check | Result |
| --- | --- |
| `pnpm i` | Passed; lockfile unchanged. pnpm reported ignored build scripts for `@vgpu/adapter-node`, `esbuild`, and `webgpu`. |
| `pnpm exec vitest run src-tauri/plugin-host --reporter=verbose` | 11 files, 84 tests passed. |
| `pnpm plugin-host:typecheck` | Passed. |
| Changed stdio test file typecheck using an isolated config extending `tsconfig.plugin-host.json` | Passed. |
| `pnpm packages:contract:check` | Passed, including packed SDK browser contracts. |
| `pnpm exec vitest run --reporter=verbose --reporter=hanging-process` | Exit 0, 897 files passed, 18 skipped; 7,731 tests passed, 3 expected failures, 100 skipped. Vitest duration 499.04s; controller duration 500.682s, below its 600s cap. |

In that complete root run, the original project and task maximum-size callbacks passed in 44ms and 41ms. The new scheduled-chunk regression passed in 127ms. No owned-group termination was needed, and no process held either owned root log after validation.

## Evidence handling and limits

Local evidence is under `src-tauri/target/ci-validation-KVG-5304/`, outside tracked source:

- `stdio-baseline.log`, `root-before.log`, and `chunk-probe-before-2.log` record the unchanged reader.
- `stdio-regression-red.log` records the failing regression before implementation.
- `stdio-regression-green.log`, `plugin-host-all.log`, `plugin-host-typecheck.log`, `stdio-test-typecheck.log`, `plugin-sdk-contract.log`, and `chunk-probe-after.log` record the affected-subsystem checks.
- `root-after.log` and `root-after.json` record the complete normally parallel root validation and controller exit.
- `run-check.mjs`, `probe.mjs`, and `tsconfig.stdio-tests.json` record the local diagnostic setup. The initial probe attempt failed because TypeScript 7 did not expose the expected transpilation API; the successful probes used Node's type stripping instead.

The controller launches its own child in an owned process group, uses an environment allowlist excluding all `OPENFORGE_*` and credential-bearing settings, and writes restricted-permission evidence. Logs redact credential-shaped fields and truncate oversized lines. Only a process group created by that controller is eligible for timeout termination; no observed developer or other-worktree PID was signalled. The root baseline's missing controller exit record remains a limitation.

The affected subsystem is the TypeScript plugin host. Its complete suite and static checks passed, with SDK contracts and the entire root test run as broader boundary coverage. Rust source and wire schemas did not change; Rust crate tests/build/clippy and packaged Electron/Bun acceptance were not rerun. The root suite's 18 skipped files and 100 skipped tests remain skipped, and its three expected failures remain expected. One green root run does not prove flake elimination across machines or replace release/update acceptance gates.

Inventory scanner work remains in KVG-5279/KVG-5287. Pi Skill Usage, daemon startup, and PTY investigations remain in KVG-5293, KVG-5290, and KVG-5245 respectively. No changes were made to those systems.

KVG-5314 tracks the adjacent built-plugin-host test harness's unbounded retained output and raw stderr in failure messages. It depends on KVG-5304 and is intentionally not fixed here.

## Completion review

The single fresh-context read-only review completed in run `838f8291-e905-4fb6-a684-86b16851462b`. Its merge verdict was to approve the implementation, with no blocking correctness or maintainability findings. It covered the complete working-tree diff from `b13f0f151e8be20ef1f17bf5d1ce33cfc50a94d7`, including this evidence document.

The reviewer independently reran the 11 stdio tests, production and changed-test typechecks, and the diff whitespace check. All passed with unchanged deadlines and parallelism. The scheduled maximum-size regression took 147ms; the original project/task cases took 63ms and 69ms. A seeded comparison against the baseline reader also passed 500 byte-chunk cases, including split Unicode and mixed delimiters. Broader subsystem and root evidence was verified from the existing logs and controller records, not rerun.

The review report is `src-tauri/target/ci-validation-KVG-5304/completion-review.md`. The source/test diff remained unchanged through the review; only this documentation status was updated afterward. The review was performed on branch `openforge/KVG-5304` before committing the changes.

The prior launch `2c957a89-14c9-4b7c-9ff8-535607cf4293` failed before a reviewer started because its compatibility check required the `@earendil-works/pi-agent-core/node` export removed in Pi 1. After owner approval, the installed subagent package's Pi 1 handling and dependency resolution were verified and the same-protocol retry succeeded. No reinstall, model change, or alternate review protocol was needed. The prior handoff snapshot remains in `src-tauri/target/ci-validation-KVG-5304/review-blocked.patch`.

The review gate is satisfied. Existing skips, expected failures, historical-evidence limits, and KVG-5206 CI/update acceptance requirements remain unchanged.
