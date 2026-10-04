# Native Ghostty host-owned snapshot fork

Task: KVG-5198. The user approved this isolated fork after the [native embedding-contract audit](native-ghostty-screen-first-contract.md).

**The native state-ownership experiment works for text. It is not a replacement renderer.** READY can become the native `Termio` owner's terminal, accept live output and receive older history without a second parser state or a replay into the live screen. Image-bearing checkpoints remain unsupported, and no frame was rendered.

**Later stage:** the separately approved [native window experiment](native-ghostty-window.md) adds a local host-backed Surface/C API and runtime Metal compilation. Its native window/state tests pass; pixel verification remains blocked by screenshot permission. The results and open gates below describe the earlier headless stage.

## Scope and artifacts

The fork uses upstream `4ae9f1a2de5484de3d6a13fe03676b8853b9c41c` and Zig `0.16.0` on macOS ARM64. The [experiment README](../../scripts/experiments/native-ghostty-fork/README.md) gives preparation and verification commands. The [patch](../../scripts/experiments/native-ghostty-fork/host-snapshot.patch) is the durable deliverable. The working checkout and build products are ignored under `artifacts/terminal-presentation/native-ghostty-fork/`.

The patch changes native `Termio` and its backend dispatch. It does not replace the renderer with a custom VT renderer. It also does not wire a new backend into `Surface`, extend `ghostty.h`, link an Electron adapter or attach to an existing OpenForge shell. Production source, dependency pins and lockfiles remain unchanged.

## Ownership that was exercised

```text
host snapshot bytes
  -> bounded owned buffer + incremental decoder
  -> READY moves Terminal into native Termio.terminal
  -> native StreamHandler attaches at that final address
  -> continuation replay is checked by re-export

host live output -> instance/byte-offset check -> native stream
history worker   -> decoder.next(&Termio.terminal)
                                      |
                    renderer.State.terminal points here
```

Both mutation paths use the native renderer-state mutex. The host backend owns no PTY or subprocess. Native input and protocol replies use its write callback; resize requests have a host callback. The focused fixture uses native mailboxes, a test-only app wakeup, and no GUI consumer.

A callback receives borrowed bytes and must copy or queue them before returning. Callbacks may not reenter `Termio`. The host serializes output calls and must stop all callers before destroying the owner. These are prototype contracts, not an implemented Electron transport or a lifecycle proof for native views.

## Observed behavior

| Case | Headless result |
| --- | --- |
| Host-owned I/O | Native thread entry/exit and input callback work without launching a child. |
| READY and live text | A 2,000-line checkpoint adopts into the native owner. Live `SCREENLIVE` text and cursor remain intact while multiple history pages arrive. Final row count matches the source. |
| Concurrent history and output | A separate producer adds 1,000 lines while the main worker decodes history. The final marker and combined row count are preserved. This is a bounded concurrency test, not a stress or latency claim. |
| Stale or out-of-order output | Wrong instance, duplicate offset and gapped offset are rejected before parsing. |
| Parser continuation | A split UTF-8 character completes after READY. A second export and adoption preserves the resulting text. Exhaustive escape/OSC/DCS continuation coverage was not added. |
| Alternate screen | The alternate screen stays active and retains newer text while primary history arrives. |
| Resize/reflow | Changing from 80 to 40 columns consumes remaining history pages with zero applied rows. The current terminal stays usable. Export refuses to call this a complete checkpoint. |
| Cancellation and malformed tail | Repeated cancellation is safe. A truncated FINISH causes an error and drops the decoder. Live output remains accepted; partial-history export is refused. Empty input fails without leaking the fixture. |
| Protocol replies | One cursor-position query produces one native-owned reply through the real native mailbox and host callback. The mailbox is drained synchronously in the test, not by a running native I/O event loop. |
| Images | A real Kitty transmission creates native image state. Snapshot export now refuses it before emitting bytes. Image restoration and pixels do not pass this gate. |

The focused command reports 86 passing tests: 10 new behavioral tests and 76 upstream tests that Zig includes despite the filter. These fixtures are not the historical browser performance fixture. No test duration is used as READY-to-pixel, PTY, IPC or presentation latency.

## The image blocker

Upstream's [snapshot test](https://github.com/ghostty-org/ghostty/blob/4ae9f1a2de5484de3d6a13fe03676b8853b9c41c/src/terminal/snapshot/snapshot.zig#L1200-L1274) explicitly preserves Kitty virtual-placeholder cells while omitting the image and placement registries. Moving a decoded terminal into the native owner cannot restore data absent from the snapshot.

The new native export checks both screens and returns `ImagesNotCheckpointed` if either registry is populated. This prevents silent image loss through this export method. It cannot detect image data that an earlier upstream export already discarded. Supporting real image-bearing checkpoints needs a resource/placement transfer contract and rendered verification, not removal of the guard.

## Validation and gaps

The [retained runner report](../../scripts/experiments/native-ghostty-fork/evidence/report.json) records the exact patch/source hashes, commands and logs. Validation covered the native fork, its test/build changes and the standalone preparation/runner scripts:

- Focused native suite: **86 passed**, including all 10 added behavioral tests.
- Full upstream native test suite: **3,817 passed, 25 skipped**, exit 0. The build summary does not identify individual skipped tests; the focused suite skipped none.
- Zig formatting, Node syntax, JSON parsing, evidence hashes, relative documentation links and source whitespace checks passed.
- Repeated preparation succeeded with 39 packages and no production dependency changes.
- A clean pinned-source patch application and reverse check reproduced all nine patched files byte-for-byte.
- Metal preflight still exits 72 because `metal` is unavailable. No renderer build/runtime result is inferred from the headless suite.

[Development checkpoints](../../scripts/experiments/native-ghostty-fork/evidence/development.json) retain red/green failures for the missing host backend, missing adoption option, missing output fencing and image-export guard. The image case first reproduced a successful but lossy export, then passed after rejection was added.

The first broad upstream run exceeded a 10-minute execution limit. It was terminated, including the remaining build/test children; that attempt is not a passing result. The retained runner uses a 20-minute per-check limit and cleans up its process group on timeout. Its subsequent full run passed.

An [earlier focused run](../../scripts/experiments/native-ghostty-fork/evidence/hosted-early-failure.log) also hit an unchanged upstream search-thread test's teardown race. Its 100 ms wait can fail after spawning a worker but before stop/join, allowing cleanup while that worker still uses the queue. Later focused and full runs passed. This is recorded separately as **KVG-5225**, dependent on KVG-5198, rather than fixed inside the snapshot experiment.

OpenForge's earlier 300 Terminal Runtime tests, type check and five pinned-native probes remain earlier validation of the unchanged production path. No production subsystem was modified in this fork stage, so those suites were not rerun. The native owner, build change and test infrastructure are the affected scope here.

The following remain outside the evidence:

- Metal compilation and actual native view creation. The local Metal compiler is unavailable. The headless build selects OpenGL only to avoid an unused shader dependency.
- The C ABI and `Surface` constructor selecting this host backend, including initialization/teardown ordering around renderer and I/O threads.
- A single production protocol-reply authority. The prototype lets native Ghostty reply; OpenForge currently has its own authoritative parser. Running both as responders is not acceptable.
- Image-bearing checkpoints, scroll-anchor/selection behavior, IME, native view detach/reattach and generation-fenced view destruction.
- A presented-output watermark, isolated rendering target, signing/packaging and READY-to-first-correct-frame measurements.
- Cross-version snapshots, incremental network delivery, OOM fault injection and exhaustive continuation boundaries. The prototype copies at most 128 MiB of snapshot data and tracks at most 64 KiB of continuation.

## Recommendation

Continue native integration only as an experiment. The text-state ownership gate is now demonstrated; a maintained fork can supply the missing internal operations. The public embedding contract still does not expose them.

Before Electron view work, choose reply ownership, define image-resource transfer and expose a host-backed surface constructor with explicit lifetime rules. Then resolve Metal tooling and test READY-to-frame behavior through that constructor. Keep xterm in production until those gates and the real-session compatibility matrix pass.
