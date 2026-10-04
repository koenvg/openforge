# Full Ghostty screen-first contract experiment

Task: KVG-5198, explicitly extended to investigate replacing xterm.

**Result: blocked at the native embedding contract.** Current upstream still cannot restore an existing OpenForge session into its full renderer through the exposed interface. This is a fresh source audit and compile experiment, not a rendered screen-first prototype. No native GUI, existing PTY or production terminal was touched.

This report records the unmodified-upstream audit. The user subsequently approved a [local native-owner fork](native-ghostty-host-snapshot-fork.md), then a [native window experiment](native-ghostty-window.md). The latter adds local Surface/C API operations and runtime Metal compilation; neither changes upstream's public contract or establishes rendered performance.

## Revision and experiment

`git ls-remote https://github.com/ghostty-org/ghostty.git HEAD` resolved to `4ae9f1a2de5484de3d6a13fe03676b8853b9c41c`. GitHub records the commit at `2026-09-22T16:01:11Z`. All source downloads use that full revision, not a moving branch. OpenForge's dependency pins remain unchanged.

The [retained experiment](../../scripts/experiments/native-ghostty-contract/README.md) downloads the pinned headers and relevant implementation files, compiles three small C probes, and uses Clang's AST to inventory all 91 native `ghostty_*` function declarations. The [machine-readable evidence](../../scripts/experiments/native-ghostty-contract/evidence/report.json) contains source URLs/hashes, signatures, exact compiler diagnostics and reviewed source excerpts.

This rechecks the first gate of [ADR 0005](../adr/0005-native-full-libghostty-renderer.md). It does not repeat the earlier experiment that successfully hosted a fresh native terminal in Electron. Hosting another fresh shell would not prove restoration of an existing session.

## What actually ran

Host: macOS ARM64, macOS 26.6.2, Node 24.14.0, Apple Clang 21.0.0.

| Probe | Result | Meaning |
| --- | --- | --- |
| Native-only header and function signatures | Compile exit 0 | Surface creation, draw and text-input declarations are available. No library linked or surface created. |
| VT-only snapshot header and function signatures | Compile exit 0 | Current upstream declares `ghostty_snapshot_decoder_ready()` and `next()`. This does not make a native view accept their result. |
| Both headers in one translation unit | Compile exit 1 | `GHOSTTY_SUCCESS` macro collides with the VT enum; `GHOSTTY_COLOR_SCHEME_LIGHT` and `DARK` enumerators are redefined. Exact diagnostics are retained. |
| Runner syntax check and declaration inventory | Exit 0 | The runner completes and records the expected mixed-header failure rather than concealing it. |
| Metal compiler preflight | Exit 72 | `xcrun --find metal` reports the tool unavailable. No installation or full native source build was attempted. |

The mixed-header failure was discovered on the first attempt. The experiment then added separate positive controls so a header collision could not be mistaken for missing decoder functions. Separate C translation units could avoid these names colliding; this is **not** the decisive architecture blocker. The blocker is the absence of a supported connection between decoded terminal state and the native surface.

## Contract findings

All links below are pinned to the audited revision.

| Required operation | Current evidence | Result |
| --- | --- | --- |
| Retain OpenForge's existing PTY and feed its output into the renderer | [`ghostty_surface_config_s`](https://github.com/ghostty-org/ghostty/blob/4ae9f1a2de5484de3d6a13fe03676b8853b9c41c/include/ghostty.h#L508-L521) configures a command, working directory and initial input, not host I/O. [`termio.backend.Kind`](https://github.com/ghostty-org/ghostty/blob/4ae9f1a2de5484de3d6a13fe03676b8853b9c41c/src/termio/backend.zig#L13-L26) has only `exec`; [`Surface` initialization](https://github.com/ghostty-org/ghostty/blob/4ae9f1a2de5484de3d6a13fe03676b8853b9c41c/src/Surface.zig#L668-L684) selects it. | Missing supported host-managed I/O. |
| Adopt the terminal returned by READY | The complete native function inventory and native surface configuration contain no checkpoint import/export or decoded-terminal attachment operation. The VT decoder returns a `GhosttyTerminal`; native draw operates on `ghostty_surface_t`. | Cannot connect READY to native rendering through the exposed interface. |
| Feed bytes through `ghostty_surface_text()` instead | [`embedded.zig`](https://github.com/ghostty-org/ghostty/blob/4ae9f1a2de5484de3d6a13fe03676b8853b9c41c/src/apprt/embedded.zig#L2070-L2076) calls `textCallback`; [`Surface.textCallback`](https://github.com/ghostty-org/ghostty/blob/4ae9f1a2de5484de3d6a13fe03676b8853b9c41c/src/Surface.zig#L3328-L3334) calls `completeClipboardPaste`. That [encodes paste input and queues an I/O write](https://github.com/ghostty-org/ghostty/blob/4ae9f1a2de5484de3d6a13fe03676b8853b9c41c/src/Surface.zig#L6146-L6223). | Wrong direction. It sends user input to the child; it is not PTY-output ingestion. |
| Recover from `read_text`, selection or `export_terminal_io` | Text APIs expose selected text. [`export_terminal_io`](https://github.com/ghostty-org/ghostty/blob/4ae9f1a2de5484de3d6a13fe03676b8853b9c41c/src/apprt/action.zig) exports the inspector event log. Neither is a state-import operation. | Does not transfer cursor/modes, images, unfinished parser state and history into a surface. |
| Know that READY or newer output was painted | Native `draw`/`refresh` return `void`. In [`Action`](https://github.com/ghostty-org/ghostty/blob/4ae9f1a2de5484de3d6a13fe03676b8853b9c41c/src/apprt/action.zig), `render` requests a redraw, `present_terminal` asks to present a tab/split/window, and `renderer_health` reports health. They do not acknowledge a presented output watermark. | A surface-created event or redraw request cannot establish first-correct-usable-screen time. |
| Isolate native rendering in a helper | Ghostty has an internal [IOSurface-backed Metal target](https://github.com/ghostty-org/ghostty/blob/4ae9f1a2de5484de3d6a13fe03676b8853b9c41c/src/renderer/metal/Target.zig), but native surface configuration accepts an NSView/UIView rather than an exported offscreen target. | Internal implementation exists; a supported host contract is not exposed. |

The [header's opening comment](https://github.com/ghostty-org/ghostty/blob/4ae9f1a2de5484de3d6a13fe03676b8853b9c41c/include/ghostty.h#L1-L12) still calls this `libghostty-internal`, tailored to the macOS app and not designed for external use. It directs external consumers to `libghostty-vt`, which does not include Ghostty's application renderer.

## Why the requested rendered experiment stopped

The intended test was to restore an existing session, paint READY, accept live output, then load history while exercising resize and detach/reopen. It stops before creating a surface: there is no exposed operation to give the native renderer the restored session or its host-owned output stream.

Passing a decoder handle to a surface function would misuse an opaque handle, not bridge the implementations. Starting a proxy command would create another PTY and replay output; it would not adopt the checkpoint or solve incremental history. Patching internal terminal storage, renderer threads and I/O was outside this audit. The later approved fork is documented separately above.

The missing Metal compiler is an additional local prerequisite, not the reason the interface gate failed. Installing it would not create the missing APIs. No old prebuilt wrapper was substituted for current upstream.

## Coverage and remaining work

The standalone experiment's complete validation was `node --check` plus the live pinned-source runner, including both positive compile controls, the expected mixed-header diagnostic, and the AST inventory. Source hashes and local report links were checked. No package or application configuration changed.

The earlier KVG-5198 run already passed 5 pinned-native probes, 300 Terminal Runtime tests and its type check. Those were not rerun for this isolated experiment. This does not extend their results to the new full-native path.

| Requested rendered case | Status |
| --- | --- |
| READY to first correct usable screen | Blocked; no native checkpoint import |
| Concurrent live output and incremental history | Blocked; no host-owned output/state attachment |
| Resize/reflow, scrolling, alternate screens, image retention | Not executed with a replacement renderer |
| Parser continuation, detach/reopen, cancellation, stale generations | Not executed with a replacement renderer |
| Fetch/decode/parse timings, history completion, memory, responsiveness | No replacement-renderer measurements available |
| Linking, native runtime, helper isolation, signing/packaging | Not attempted after the contract gate failed |

No mocked pass, screenshot of a different shell, or compile time is reported as screen-first performance.

## Recommendation

Replacing xterm remains possible in principle, but **current full Ghostty is not a supported drop-in route**. Proceeding requires a separately approved upstream contribution or maintained fork that supplies host-managed I/O, snapshot adoption/export, presented-watermark reporting and an isolated rendering target. One terminal state owner must remain responsible for protocol replies; simply adding a second authoritative Ghostty surface is not acceptable.

The next useful decision is whether maintaining that native integration is worth the scope. If it is, the first deliverable should be a native contract patch and headless state-ownership tests, before Electron view work. If it is not, retain xterm or evaluate a renderer with an explicit state/history-import interface. Do not call a custom `libghostty-vt` renderer the full Ghostty renderer.

No production migration, upstream issue submission, dependency upgrade or new implementation task was started. Existing cleanup KVG-5214 remains separate.
