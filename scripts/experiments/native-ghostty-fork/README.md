# Native Ghostty host-owned state experiment

KVG-5198 follow-up, approved after the [unmodified embedding-contract audit](../../../docs/experiments/native-ghostty-screen-first-contract.md).

This is a local fork of full Ghostty at `4ae9f1a2de5484de3d6a13fe03676b8853b9c41c`. It exercises the native `termio.Termio` owner and its `StreamHandler`, rather than another `libghostty-vt` wrapper. It does not create a native view, draw frames, attach an OpenForge PTY, or change production dependencies.

## Reproduce

Requires macOS ARM64, Zig `0.16.0`, Node, Git, the macOS SDK and network access for preparation. Metal is not required for these headless tests.

From the OpenForge repository root:

```sh
node scripts/experiments/native-ghostty-fork/prepare.mjs
node scripts/experiments/native-ghostty-fork/run.mjs --full
```

`prepare.mjs` creates an isolated checkout under `artifacts/terminal-presentation/native-ghostty-fork/upstream` on `experiment/openforge-host-snapshot`. It prepares dependency packages alongside the checkout, reusing the existing cache through symlinks where possible and verifying downloaded packages with Zig's dependency hashes. It does not edit the shared Ghostty source cache or OpenForge's pins.

`run.mjs` applies [host-snapshot.patch](host-snapshot.patch) to the pinned checkout. It refuses an unexpected revision, unexpected changed files, or a dirty checkout that does not already contain the patch. Repeat runs accept an already-applied patch. It checks Zig formatting, runs the focused tests, and runs the full upstream suite when `--full` is present. Each test command has a 20-minute limit. Omitting `--full` runs only the focused suite. A first full compilation can take several minutes.

For an alternate artifact directory, pass it as the first argument to `prepare.mjs` and set `GHOSTTY_FORK_ROOT` to that same directory for `run.mjs`.

The generated `report.json` and logs live in the artifact root. The report records the patch hash, all nine patched file hashes, commands, exit codes and test names. Retained evidence and the validation gaps are described in the [findings](../../../docs/experiments/native-ghostty-host-snapshot-fork.md).

The retained [final report](evidence/report.json) records 86 focused passes and 3,817 full-suite passes with 25 upstream skips. [Development checkpoints](evidence/development.json) retain earlier failures and the first broad attempt's timeout. The passing full run does not erase the separately recorded upstream search-thread test race, KVG-5225.

## What the patch changes

- Adds a host backend with synchronous write and resize callbacks, no child process and no PTY allocation. The host must copy callback bytes, handle transport backpressure and avoid reentering `Termio` from a callback.
- Adds `Options.host_snapshot`. READY transfers the decoded terminal into `Termio.terminal` before constructing the native stream and replaying its continuation. `renderer.State.terminal` points to that same stable address.
- Adds fenced `processHostedOutput(instance_id, offset, bytes)`, one-page `nextHostedHistory()`, cancellation, and native snapshot export. Parsing and history application use the native renderer-state mutex.
- Skips the Metal shader dependency for the test build's OpenGL configuration. No OpenGL context is created by the focused tests. The `none` app runtime gets a test-only wakeup operation; the fixture drains native mailboxes instead of running a GUI event loop.

The host chooses a unique instance token and initializes the byte offset to the snapshot cut. Neither is part of Ghostty's snapshot. Offsets acknowledge parsing, not pixels. Host output calls must have one serialized producer; the history worker can run concurrently. Owner destruction still requires all callers and threads to stop first.

The default native `Surface` constructor and `ghostty.h` are unchanged. Nothing in the public embedding API selects this backend yet. There is no Electron adapter or C ABI attachment implementation in this patch.

## Tests and limits

Ten focused behavioral tests cover host input, READY ownership, live output during history, stale/duplicate/gapped output, repeated UTF-8 continuation restoration, image-export refusal, incompatible resize, cancellation/truncation, alternate-screen state, one native protocol reply, and a concurrent producer/history worker. Some tests cover several related cases. Zig also runs 76 unfiltered upstream tests, so the focused command reports 86 tests in total.

The fixtures use 80 columns, 20 rows and 2,000 text lines. The concurrent test adds another 1,000 lines. These are correctness checks, not the historical 30,000-line browser benchmark and not timing measurements.

Important boundaries:

- The entire snapshot is copied into memory before READY. Input is capped at 128 MiB; continuation tracking is capped at 64 KiB. These are experimental limits, not production policies. Network starvation and bounded-memory streaming are not implemented.
- The requested grid must match the snapshot at adoption. A later native resize is allowed, but incompatible history pages are consumed with zero applied rows. Cancelled, failed or discarded history cannot be exported as a complete checkpoint.
- Upstream snapshots omit Kitty image storage and placements. Native export rejects either resource before writing bytes. This does not repair already-lossy upstream snapshots or establish image-rendering support.
- The native parser is the sole protocol-reply authority in these tests. OpenForge's backend parser is not running alongside it. Preserving OpenForge authority requires a separate reply-routing decision before integration.
- No rendered READY timing, paint acknowledgement, scrolling/selection UI, IME, GUI detach/reattach, native packaging or cross-version snapshot compatibility is established.

Do not copy this patch into production dependencies as a renderer migration.
