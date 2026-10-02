# Fresh Session Daemon startup investigation

KVG-5290 investigation checkpoint against `3a78e23096cbf05344d45fcf6b5f390cfb285b57`. Background fixture bootstrap is now implemented after approval of the public Client and Sidecar regression boundaries. Ordinary startup and image-probe deadlines are unchanged.

## What the evidence establishes

Before the fix, fresh-start timeouts reproduced in the normally parallel Sidecar contracts when the selected daemon is built with `replacement-fixtures`. In these failures, the daemon publishes its private socket before synchronously bootstrapping its replacement image. The copied image's preflight delays authenticated request handling beyond the client's startup wait. The later `session daemon ready` log does not mean the daemon was serving before the client timed out.

At the investigation baseline, `server::run` called `Manager::new` before `serve`. On macOS arm64 with `replacement-fixtures`, `Manager::new` synchronously called `images::bootstrap`, which copies, hashes and probes the current executable. Without that feature, it does not bootstrap an image. This is a fixture-build difference, not evidence of a production default-feature daemon failure.

The merged KVG-5188 fix, `de5f2b881aa4f440b4de45263b33fe828a828070`, is an ancestor of this investigation's HEAD. `Client::launch` still uses five seconds. Image preflight separately allows twenty seconds for startup and two seconds for execution after readiness. Those probe budgets do not make first attachment independent of synchronous bootstrap. The later probe-orchestration split is also present in this checkout.

The original KVG-5206 logs are no longer available. Its two retained directories contain no startup log or runtime metadata. Their daemon build features cannot be established here. The new reproduction explains the same error and late-ready observation, but does not prove that the historical failures had this cause. Nothing in this evidence connects the timeouts to the source parent-exit guard or to KVG-5245's openpty ENXIO investigation.

## Measured sequence

Third diagnostic run, `providers::codex_keeps_agent_and_tool_through_replacement`, private root `/tmp/of-replace-0yOyTo`. Times are seconds since the client's spawn began.

| Time | Observation |
| --- | --- |
| 0.000 | Client begins daemon spawn. |
| 0.008 | Spawn returns with its owned child handle. |
| 1.448 | Daemon enters ordinary startup. |
| 1.461 | Existing private discovery and credentials pass runtime validation. |
| 1.464 | Control socket is bound, private permissions applied, and nonblocking listener configured. |
| 1.466 | Replacement-fixture bootstrap begins. |
| 2.177 | Copy, sync and parent-side image hashing have completed; image-probe spawn begins. |
| 2.182 to 2.216 | Probe's inherited-descriptor sweep executes. |
| 2.220 | Probe spawn returns. |
| 6.481 | Client reports transport read timeout and then daemon startup timeout. |
| 7.183 | Copied image enters its image-preflight handler and emits readiness. |
| 7.216 | Bootstrap probe completes. |
| 7.245 | Daemon reaches its serving loop. |
| 7.246 | Daemon authenticates and dispatches a queued Connect request. |

The copied probe's post-spawn, pre-handler interval is about 4.96 seconds. Its descriptor sweep is 34 ms, and post-entry probe completion is about 33 ms. Across the third run, 21 measured sweeps took 30 to 300 ms. The sweep is not the dominant delay in this reproduced failure. No loader sampling or OS tracing was used, so the specific cause of the pre-handler delay is not established. Do not infer XProtect solely from the interval or from KVG-5188's separate investigation.

The five-second per-exchange socket read can begin after launch polling has already consumed time. This explains the roughly 6.48-second caller timeout above; the outer launch deadline is checked after the blocking exchange fails. A successful late daemon-side authentication is not a successful client attachment.

## Reproduction and comparison

All runs used the same command, with no test-thread override:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --test session_daemon_sidecar -- --ignored
```

Inherited `OPENFORGE_*` variables were removed before every Cargo invocation. `CARGO_TARGET_DIR` was `/tmp/KVG-5290-target-nKdKcM`. Each Sidecar fixture cleared its child environment and used its own installation, credentials, home, database and sockets. The host was native macOS arm64 with ten logical CPUs. Host limits were only read, never changed.

The fixture hardcodes `crates/session-daemon/target/debug/openforge-session-daemon`. A temporary generated symlink selected the daemon just built in the private target; otherwise a private backend target does not determine the daemon artifact. That symlink has been removed. KVG-5325 owns explicit private artifact selection.

| Daemon build | Diagnostic run | Result |
| --- | --- | --- |
| `cargo build --manifest-path src-tauri/crates/session-daemon/Cargo.toml --features replacement-fixtures` | Initial startup stages | 17 passed, 10 failed, 30.64 s |
| Same feature build | Copy/hash/probe spawn stages | 24 passed, 3 failed, 28.68 s |
| Same feature build | Probe handler entry and native sweep timestamps | 24 passed, 3 failed, 31.47 s |
| `cargo build --manifest-path src-tauri/crates/session-daemon/Cargo.toml` | Default-feature comparison | 27 passed, 0 failed, 50.01 s |

Five installed-provider demonstrations return early when their explicit live-provider variables are absent. They are included in Cargo's pass count, not claimed as live-provider coverage. One non-ignored case was filtered out. The default comparison captured 23 fresh authenticated launches, taking 84 to 1,856 ms from spawn begin. It is a different compiled feature set, not a passing retry offered as a causal explanation.

Instrumentation recorded wall-clock timestamps and stage labels without credentials or session output. Probe readiness kept its original leading marker and existing buffer bound. Sweep timestamps used only native clock and write calls after fork. The diagnostics were temporary and have been removed from source. They did not change deadlines, parallelism, host admission limits, authentication or cleanup policy. Their timing overhead and uncontrolled machine activity remain measurement limitations.

Raw local evidence is under `/tmp/KVG-5290-evidence/`: `parallel-1.log`, `parallel-2.log`, `parallel-3.log`, `parallel-default.log`, their status files and structured `*-traces.json`, `preexec.bin`, `diagnostic.patch`, and `cleanup-check.json`. The patch is diagnostic-only, not a proposed production change.

Existing fixture cleanup used owned Sidecar child handles and authenticated daemon operations. All sixteen retained failed runtimes subsequently had both launch and daemon ownership locks confirmed free, with no remaining control socket. Their diagnostic directories remain intact. No observed orphan or grandchild PID was signalled, and no developer runtime was contacted.

## Implementation and regression coverage

`Manager::new` starts a separately owned fixture-bootstrap worker instead of copying and probing an image on the serving thread. Capabilities report replacement unavailable while validation is pending or has failed. The daemon's existing wake pipe publishes successful validation to the serving loop. Restored managers do not start another bootstrap. Default-feature production activation remains disabled.

The worker owns a cancellation flag and a join handle. Empty shutdown or startup failure cancels image preflight through its existing owned helper handle and joins the worker before releasing daemon ownership. Descriptor isolation, clean probe environment, image/version checks, and probe execution/startup budgets are retained. Cancellation does not pretend to interrupt synchronous file I/O or kernel spawn; ownership remains held until the worker actually exits.

A dedicated `replacement-fixtures` startup binary can hold image readiness at an owned private socket. It has no environment-variable bypass and is not a production daemon. The public Client regression first failed with the original daemon startup timeout, then passed after background bootstrap was implemented. It proves ordinary launch, reattachment, inventory and Sidecar registration work while image readiness is held; replacement stays refused until the gate is released and validation succeeds. Additional Client regressions prove failed validation leaves ordinary serving intact and empty shutdown disconnects and reaps a held probe without signalling an observed PID.

The real private Sidecar regression verifies health readiness and its registered controller while image readiness is held, checks maintenance replacement refusal, then exercises empty shutdown and passive probe disconnect. The contract launcher explicitly builds only the special startup binary with the fixture feature before building the ordinary daemon without it. Its command-boundary regression failed before that recipe was added and then passed. Existing replacement-only fixtures now wait for the public verified-replacement capability using their existing replacement readiness budget, rather than treating ordinary attachment as proof of image validation.

Cleanup follow-ups are KVG-5325 for explicit private daemon artifact selection and KVG-5329 for separating the existing replacement operation coordinator from checkpoint/exec concerns. The latter is distinct from KVG-5326's end-to-end pause-budget work.

## Validation and remaining limits

The default and all-feature test suites passed for session-host, session-protocol, session-client, session-daemon and the Sidecar backend. The Client startup regressions passed, as did the focused real Sidecar regression. Default and all-feature `cargo check --all-targets`, `cargo clippy --all-targets` and `cargo build` passed for all five crates without Clippy warnings. Launcher Vitest and Node syntax checks passed. Formatting passed for host, client, daemon and backend; unchanged protocol `notification.rs` formatting still fails and is already tracked by KVG-5291.

The first post-fix normal-parallel feature-daemon run passed the 27 existing Sidecar cases but failed the new special-fixture case with an ordinary startup timeout. Its daemon log was empty during cleanup and later contained readiness. This run does not establish which pre-serving stage delayed that special fixture. A subsequent normally parallel diagnostic run passed all 28 cases. That passing retry is not a causal explanation of the first failure. The additional temporary client/server diagnostics were removed, and both files match the investigation baseline again.

The contract launcher stopped at the unchanged `daemon_bridge_forwards_ordered_output_and_reconciles_gap_and_exit_after_replacement` assertion. It forwarded 540,620 bytes and final output without a reconnect event. KVG-5309 already owns this obsolete polling-specific fault injection after push subscriptions were introduced. No production event-loss cause is established here. The remaining launcher groups passed separately: daemon Pi lifecycle, daemon transport, plugin shell callbacks and companion terminal integration. The final-source all-feature daemon suite passed again, including all three startup regressions. Final-source Sidecar contracts with the default ordinary daemon passed all 28 cases in 14.69 seconds.

A final-source normal-parallel feature-daemon run passed the new startup case and all ordinary startup paths, but failed four later provider proof/CLI marker waits. It finished with 24 passed and four failed in 27.36 seconds. These are not the original startup-timeout error; their relationship to background bootstrap load is not established. Preserve this failed run as `parallel-final-feature.log` rather than treating the preceding 28-case diagnostic success as a clean feature-build gate.

The failed private runtime `/tmp/of-replace-0xqXTc` started after existing fixture cleanup had treated absent socket publication as success. It was stopped through authenticated `--terminate-sessions` recovery, without signalling an observed PID. Both ownership locks are now free and its control socket is absent. KVG-5336 now owns this separate late-start fixture-cleanup issue and depends on KVG-5290. Its never-started prompt was corrected after discovering that the initial event-gap scope duplicated KVG-5309.

Full validation is not clean. The single fresh-context completion review found no implementation defect or structural blocker, but its verdict is hold for validation. No second review was run. The report is `/tmp/KVG-5290-evidence/completion-review.md`. Packaged cold launch, native x64 behavior, live providers and the historical KVG-5206 startup cause remain unverified.

## Follow-up investigation of the review blockers

The special-fixture startup timeout reproduced again in `/tmp/of-replace-Izv1kW`. Spawn returned in 8.89 ms. The process did not reach `server::run` for another 5.129 seconds. It then published its socket in 2.05 ms and reached serving 38.42 ms after server entry, while bootstrap was still running. Bootstrap completed 1.94 seconds after it began. This timeout therefore preceded this daemon's bootstrap work; it was not another synchronous image-validation stall. The earlier `/tmp/of-replace-0xqXTc` incident has no comparable entry timestamps, so do not assign this new sequence to that historical event as proven fact.

Passive process observations showed the special fixture sleeping with zero recorded CPU before its startup handler. A narrow unified-log lookup produced only a user-ID retrieval event, not a specific launch-delay explanation. A later run with loader-statistics output requested emitted no loader statistics. No XProtect or other OS-service cause is established. The early failure was captured in the first diagnostic series, whose whole-run comparison is invalid because the observer incorrectly tried to open an absent cold-installation root. Keep its individual process timestamps, not its pass counts as an acceptance result.

After repairing the observer, four normal-parallel runs used the same diagnostic feature-daemon bytes, in on/off/off/on order. Each passed all 28 cases. The off mode suppressed ordinary fixture bootstrap only; the dedicated held-readiness startup fixture still bootstrapped so its public regression remained meaningful. Captured bootstrap counts were 24, 1, 1 and 24. The byte identity is recorded in `investigation-2/binary-identity-valid-comparison.json`.

Those runs did not reproduce the four prior provider failures and therefore do not establish their independence from bootstrap. The retained failed provider-scoping roots contain an invocation record for the first helper but none for the second. That record is written after the initial tool spawn, so its absence does not distinguish pre-script delay from a stall in that early spawn or record-writing step. The retained Pi output shows CLI input and a completed geometry query but no CLI result; it does not timestamp when the nested CLI actually started. In the corrected comparison, Pi CLI calls completed in 0.55 to 5.25 seconds. No request or fixture deadline was changed.

Evidence is under `/tmp/KVG-5290-evidence/investigation-2/`, including per-runtime daemon/Sidecar logs, helper events, passive process samples, on/off run logs, binary identities and `temporary-diagnostics.patch`. The additional delayed runtime was stopped by authenticated recovery; both ownership locks are free and its control socket is absent. All nine temporarily modified source files were restored byte-for-byte to their pre-investigation contents, and the temporary observer module was removed. No persistent runtime change was made by this follow-up. After restoration, all three Client startup regressions passed, the ordinary feature daemon rebuilt successfully, and normal-parallel Sidecar contracts passed 28/28 in 19.09 seconds. These reruns do not explain the earlier failures. The provider-wait cause remains open, and passing comparisons do not clear the merge hold.
