# Native Ghostty window: host snapshots through a real Surface

Task: KVG-5198. This is the subsequently approved window experiment, after the [unmodified-upstream contract audit](native-ghostty-screen-first-contract.md) and [headless native-owner fork](native-ghostty-host-snapshot-fork.md).

**A local host-backed native Surface now works in an AppKit fixture window. Pixel correctness is not yet verified.** The prototype connects the restored terminal to Ghostty's real Metal renderer, rather than an xterm replay or a custom VT renderer. It does not attach an existing OpenForge session or run a shell.

## Try it

```sh
node scripts/experiments/native-ghostty-window/prepare.mjs
node scripts/experiments/native-ghostty-window/run.mjs
```

Run from the repository root. The [README](../../scripts/experiments/native-ghostty-window/README.md) describes controls, prerequisites and verification commands. **Checkpoint & restore**, **Load one page**, **Load remaining**, **Live output**, **Add image**, and **Reset fixture** expose the experimental operations. Input is reported in the footer, not executed.

## What changed

The isolated checkout is `artifacts/terminal-presentation/native-ghostty-window/upstream`, at upstream `4ae9f1a2de5484de3d6a13fe03676b8853b9c41c`, branch `experiment/openforge-native-window`. It uses Zig `0.16.0` and reuses prepared dependency packages, not another renderer binary.

The [extension patch](../../scripts/experiments/native-ghostty-window/hosted-window.patch) applies after the headless fork's patch. Together they change 16 upstream files. OpenForge production source, dependency pins, lockfiles and its existing headless-fork checkout remain unchanged.

### Native surface and C boundary

Five local C functions in `ghostty-hosted.h` expose host-backed creation, fenced output, checkpoint export, one-page history advancement and history cancellation. They are experimental fork symbols, **not supported upstream embedding APIs**.

```text
AppKit fixture producer
  -> owner token + byte offset
  -> hosted C API
  -> native Surface / Termio
       READY -> one stable Terminal owner <- decoder.next()
                       |
                       +-> native renderer state -> Metal renderer

native input -> native I/O thread -> host callback -> main-thread notification
```

The host constructor bypasses `Exec`: it creates no PTY or child. It provides pixel dimensions before core initialization, so the snapshot must match the resulting grid. The snapshot bytes are copied by the existing bounded restore owner. The borrowed snapshot pointer is cleared before either native thread starts; callback configuration remains stable thereafter.

All exported host operations run on the main thread in this demo. Live output and history still share the native renderer-state mutex with rendering. The output offset acknowledges parsing, not presentation. Tokens and the initial offset are host-supplied, not embedded in upstream snapshots.

The demo constructs the replacement in an unattached NSView and adopts READY before replacing the visible view. It retains the old view and callback context through native thread shutdown. Queued input notifications check attachment identity before updating the current UI. This exercises bounded creation/destruction; it is not a real-session detach/reconnect protocol, an output/input drain barrier, or an exported offscreen target.

### Metal without the command-line compiler

`xcrun --find metal` remains unavailable on this machine. A default-off `-Dexperimental-runtime-metal=true` build option embeds Ghostty's unchanged shader source and compiles it with `MTLDevice newLibraryWithSource:options:error:`. The ordinary compiled-metallib path is retained when the option is off.

The runtime preflight compiled all nine shader functions on **Apple M5**. The native static library and AppKit executable then built and opened a window. This removes the local shader-compiler prerequisite for this experiment only; it does not validate other GPUs, older macOS releases, distribution/signing, shader startup cost, or the normal Ghostty application build.

## Validation

Exact commands, patch/source/harness hashes and log hashes are in the [retained report](../../scripts/experiments/native-ghostty-window/evidence/report.json). These are new results for the window fork, not reused browser restoration measurements.

| Check | Result and scope |
| --- | --- |
| Runtime Metal preflight | Exit 0; nine functions compiled on Apple M5. No pixel assertion. |
| Native library | 116/116 build steps succeeded with the experimental Metal path. |
| C contract probe | Linked and ran successfully; invalid constructor arguments return null. |
| AppKit integration test | Passed using real Surface creation and native threads; checks listed below. |
| Focused upstream test command | 86/86 passed: 10 hosted behavioral tests plus 76 included upstream tests. |
| Full upstream native test suite | 3,817 passed, 25 skipped; 102/102 build steps succeeded. The final explicit-Node command took 361,711 ms, approximately 6 minutes. Skip names were not emitted. |
| Static and reproduction checks | Zig formatting; Objective-C/C compilation with `-Wall -Wextra -Werror`; Node syntax; clean pinned-checkout preparation and repeat preparation; exact resulting source hashes. |
| Screenshot/visual verification | Blocked. `screencapture` exited 1 and `CGPreflightScreenCaptureAccess()` returned false. No screenshot or pixel-correctness result is claimed. |

The AppKit test verifies:

- The fixture's READY marker is available through the native text API.
- A malformed snapshot leaves the original surface intact.
- READY restores identical active text into a replacement native surface.
- Stale-owner and gapped output are rejected; valid newer text survives all history advances.
- Ten additional adoption/teardown cycles preserve active text, with queued app/render callbacks serviced between cycles.
- An input submission produces the expected 11-byte callback total through the running native I/O thread. This checks byte count, not callback contents or real transport delivery.
- Cancelled history and image-bearing state cannot export a supposedly complete checkpoint.

The first fixture takes six decoder advances including FINISH. This is not six recovered history pages or a latency measurement. The test's short run-loop intervals service callbacks; they are not presentation acknowledgments.

The affected system is the experimental native Ghostty fork, C boundary, AppKit harness and build/test scripts. Full native validation was required because this changes thread lifetime and a C boundary. OpenForge's Electron, renderer, Rust sidecar and Terminal Runtime are unchanged; their suites were not rerun in this stage. The earlier five pinned-native probes and 300 Terminal Runtime tests/type check remain separately recorded prior results.

### Failures retained

[Development evidence](../../scripts/experiments/native-ghostty-window/evidence/development.json) records the initial missing-C-symbol red test, a build failure caused by passing a symlinked package directory to Zig, the successful physical-path correction, and the screenshot permission blocker. The headless fork's earlier timeout/search-thread race evidence remains in its own report; no such failure occurred in the retained window-fork full run.

The [initial full native run](../../scripts/experiments/native-ghostty-window/evidence/initial-full.json) also passed, taking 517,786 ms. During a later housekeeping check, the sandbox's `process.execPath` resolved to Bun rather than Node: `--check` executed the launcher instead of only checking syntax, and that housekeeping call timed out. It is not counted as a passing check. Explicit `node --check` succeeded afterward, and the entire final runner was rerun with explicit `node`, including the GUI test and full native suite.

A clean pinned checkout, using local Git objects and cached packages, accepted both patches and matched all 16 tested files. Repeated preparation passed with 39 packages. This checks patch application and preparation, not a second cold network bootstrap or an independent rebuild on different hardware.

## Remaining gates

- **Visual review:** inspect initial/READY/live frames, scrolling, selection, reflow, resize during history loading, image pixels and replacement transitions. The preview opened, but this session cannot capture it without Screen Recording permission. Opening the demo itself needs no such permission.
- **Real-session transport:** connect an existing OpenForge PTY/IPC stream; handle reconnect, input/reply draining, generation fencing, cancellation and owner destruction under real transport timing. The fixture has one serialized producer and no remote endpoint.
- **One response authority:** native Ghostty owns fixture replies. Production OpenForge already has an authoritative parser; both must not respond to the same terminal query.
- **Images:** upstream checkpoints omit Kitty resource/placement registries. The export guard remains. The Add image control does not establish restored image pixels or repair already-lossy checkpoints.
- **Presentation accounting:** no output watermark, first-correct-frame measurement or independent offscreen renderer contract exists here. A redraw request or renderer-health event is not pixel proof.
- **Compatibility:** test production-pinned snapshot versions, exhaustive continuation cuts, large/OOM cases, allocation/thread-start failures, settings/font inheritance and diverse hardware. The demo retains the 128 MiB snapshot and 64 KiB continuation limits.
- **Desktop integration:** Electron embedding, native view layering, IME, clipboard, terminal accessibility, signing and packaging are not supplied by this harness.

Keep xterm in production. The local Surface/C boundary is now demonstrated; the next step is visual verification, followed by a deliberately scoped real-session adapter—not treating this fixture as a completed renderer migration.
