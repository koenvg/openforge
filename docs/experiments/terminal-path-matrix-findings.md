# Terminal path matrix findings

Task: KVG-4434

## Decision

Keep Ghostty synchronously in the authoritative terminal path and keep Electron IPC as the live transport. Build Ghostty with optimized Zig code in development and performance runs.

The original 2×2 matrix compared raw presentation against Ghostty compiled with Zig `Debug`. It therefore overstated the architectural benefit of bypassing the terminal model. In an attested rerun, Ghostty `ReleaseFast` with the existing model plus Electron IPC path reached a 3.167 MiB/s median: 40.5× the Debug median, 3.17× the 1.0 MiB/s gate, and 29.8% above the earlier raw-bypass reference.

The experiment-only raw-presentation and WebSocket runtime paths are not being adopted. Their reports remain as investigation evidence.

## Benchmark correction

`scripts/electron-dev.mjs` launches the Rust sidecar from `cargo build`. `libghostty-vt-sys` maps that Cargo debug profile to Zig `-Doptimize=Debug` unless `LIBGHOSTTY_VT_SYS_OPTIMIZE` is set. Packaged Cargo release builds use optimized Ghostty, normally `ReleaseFast`.

The initial matrix therefore answered a narrower question than intended: it measured removal of an unoptimized Ghostty parser, not removal of the Ghostty architecture used by a packaged application.

KVG-4434 now applies these build settings:

- Electron development: default Ghostty to `ReleaseSafe`;
- full-app terminal performance runner: use `ReleaseFast`, matching packaged builds;
- explicit `LIBGHOSTTY_VT_SYS_OPTIMIZE` values still override the development default;
- packaged release behavior remains unchanged.

## Original path matrix

The harness ran a 2×2 attribution matrix with a 1 MiB fixture:

| Cell | Presentation | Live output transport | Median throughput |
| --- | --- | --- | ---: |
| A | Ghostty/model-gated, Zig Debug | SSE through Electron IPC | **0.078 MiB/s** |
| B | Ghostty/model-gated, Zig Debug | Direct binary WebSocket | **0.023 MiB/s** |
| C | Raw sequenced PTY output; model feed bypassed | SSE through Electron IPC | **2.440 MiB/s** |
| D | Raw sequenced PTY output; model feed bypassed | Direct binary WebSocket | **2.743 MiB/s** |

The raw cells established that Electron IPC was capable of exceeding the acceptance gate. The close C/D results also showed that direct WebSocket transport was not foundational. The model-cell result cannot be used to reject Ghostty because those cells used Zig Debug code.

## Optimized Ghostty results

The initial optimized spot check used explicit build environment variables, model presentation, Electron IPC, the portable `baseline` CPU target, and the same 1 MiB fixture. Those reports predate build-provenance fields, so their optimization modes are classified by the recorded commands and output directories rather than by self-attestation:

| Ghostty optimization | Successful-run throughput | Median throughput | Median duration |
| --- | ---: | ---: | ---: |
| ReleaseSafe spot check | 1.506, 1.586, 2.517 MiB/s | **1.586 MiB/s** | 631 ms |
| ReleaseFast spot check | 2.228, 2.149, 2.315 MiB/s | **2.228 MiB/s** | 449 ms |

The performance report now records the effective Ghostty optimization mode, CPU target, source revision, and tracked-working-tree dirty state. Three regenerated reports self-attest `ReleaseFast`, `baseline`, revision `78ce96156760ccd4ecd70450863914c4e4e0c8a5`, and `trackedWorkingTreeDirty: true`:

| Configuration | Successful-run throughput | Median throughput | Median duration |
| --- | ---: | ---: | ---: |
| ReleaseFast, attested | 2.639, 3.546, 3.167 MiB/s | **3.167 MiB/s** | 316 ms |
| Debug historical reference | 0.071, 0.114, 0.078 MiB/s | **0.078 MiB/s** | 12,800 ms |
| Raw-bypass historical reference | 2.349, 3.014, 2.440 MiB/s | **2.440 MiB/s** | 410 ms |

The attested ReleaseFast model path exceeded the gate by 3.17× and the historical raw-bypass median by 29.8%. Cross-run machine noise prevents treating that margin as a stable model-versus-raw speedup; it does establish that optimized Ghostty is not preventing this fixture from meeting the target.

## Interpretation

1. **The measured bottleneck was Ghostty's build mode.** The attested ReleaseFast median was 40.5× the Debug median.
2. **Ghostty can remain authoritative.** The optimized model path clears the throughput target while retaining the snapshot and recovery semantics that eliminated prior recovery bugs.
3. **Electron remains adequate.** Attested model plus Electron IPC reached a 3.167 MiB/s median without a second hot-data protocol.
4. **WebSocket remains unjustified by these measurements.** It did not improve the Debug model cell and only modestly changed raw throughput.
5. **Raw presentation remains a possible future design, not the current recommendation.** KVG-4467 tracks an `opsx-explore`-first investigation that must challenge its necessity before proposing production architecture.

## Reliability and limits

One original Debug A attempt failed the existing incomplete-output-sequence check tracked by KVG-4429. Failed attempts were excluded from medians. All six optimized spot-check attempts and all three attested ReleaseFast attempts passed.

These measurements use a deterministic 1 MiB fixture. A packaged-app run plus realistic log and TUI workloads remain useful release evidence. `LIBGHOSTTY_VT_SYS_CPU=native` was not measured because production packaging uses the portable `baseline` target.

## Artifacts

Aggregate data:

```text
artifacts/terminal-experiment/aggregate.json
artifacts/terminal-experiment/ghostty-optimized-aggregate.json
```

Spot-check and attested run reports:

```text
artifacts/terminal-experiment/ghostty-releasesafe-model-electron-ipc-attempt-01/report.json
artifacts/terminal-experiment/ghostty-releasesafe-model-electron-ipc-attempt-02/report.json
artifacts/terminal-experiment/ghostty-releasesafe-model-electron-ipc-attempt-03/report.json
artifacts/terminal-experiment/ghostty-releasefast-model-electron-ipc-attempt-01/report.json
artifacts/terminal-experiment/ghostty-releasefast-model-electron-ipc-attempt-02/report.json
artifacts/terminal-experiment/ghostty-releasefast-model-electron-ipc-attempt-03/report.json
artifacts/terminal-experiment/ghostty-releasefast-attested-attempt-01/report.json
artifacts/terminal-experiment/ghostty-releasefast-attested-attempt-02/report.json
artifacts/terminal-experiment/ghostty-releasefast-attested-attempt-03/report.json
```
