# Native full-libghostty renderer findings

Task: KVG-4003

Decision: no-go on the current upstream API. See `docs/adr/0005-native-full-libghostty-renderer.md`.

## What was tested

A disposable probe loaded a checksum-pinned full Ghostty renderer into a Swift dynamic library. A 58 KB N-API addon took Electron's macOS native window handle, recovered its `NSView`, and asked Swift to add a Ghostty terminal view at bounds measured in the Electron renderer. The implementation and build artifacts were removed after this document captured the results.

The terminal is native. Ghostty owns the parser, state, PTY, CoreText font handling, IOSurface-backed Metal layer, input path, and repaint loop. There is no DOM terminal, WASM terminal, xterm bridge, or wterm intermediary.

The view was created successfully and the Electron process stayed alive during the interactive probe. Command-D hid and showed the native view without destroying the logical surface. The bridge converted renderer top-left coordinates into AppKit bottom-left coordinates and sent size changes to the terminal view.

This proves the narrow host mechanism. It does not make that mechanism safe to ship.

## Revisions and build evidence

The current full API was read at Ghostty `557253d8f64f8b08da33f5a7f3cb33a75960b09d`, and a source build was attempted with Zig 0.16.0. Dependency preparation downloaded and identity-checked 39 Zig packages in 154 seconds. The full source build then stopped after 66 seconds because the active Command Line Tools installation has no `metal` compiler:

```text
xcrun: error: unable to find utility "metal", not a developer tool or in PATH
```

This is a valid pre-session preparation failure. Current Ghostty embeds its metallib during the build. Installing JavaScript packages is not enough.

The audit checkout had one local build-only change that asked Ghostty's existing macOS static-library build step to install its archive and header. It did not change terminal or renderer code. The missing Metal compiler stopped the build before that artifact could be produced.

The runnable probe used the prebuilt `libghostty-spm` 1.4.0 artifact, which identifies Ghostty v1.3.1 commit `332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28`. SwiftPM verified checksum `68156e6c8f384816a6fa9703a589f82cebd16702887aa4073ee06b7943ec4ecb`. The wrapper package was pinned at `356f730bec03281fc7b83666a129b0246137ea26`.

The clean probe build took 40 seconds with downloaded dependencies cached.

| Artifact | Measured size |
| --- | ---: |
| Patched static `libghostty.a` | 40,388,624 bytes |
| Swift bridge with linked Ghostty code | 9,804,080 bytes |
| N-API addon | 57,712 bytes |

Both produced Mach-O files were arm64 and ad-hoc signed. The bridge links AppKit, Carbon, Combine, CoreGraphics, CoreText, CoreVideo, IOSurface, Metal, QuartzCore, SwiftUI, and system Swift libraries. This was not a universal build, hardened-runtime signature, packaged application, Gatekeeper test, or notarized artifact.

## Measurements

The measured host was Apple Silicon macOS with Electron 43.4.1. Benchmark mode created one surface whose command wrote 32 MiB, dispatched 200 focus calls, dispatched 401 sizes across alternating bounds, hid and showed the view, observed the Electron main process for five seconds, destroyed the surface, and sampled memory two seconds later. The table reports one characterization run, not a statistically stable comparison.

| Measurement | Result | What it means |
| --- | ---: | --- |
| Host start to surface-created callback | 414.7 ms | Native object creation only, not first presented frame |
| Focus dispatch | 55.9 microseconds mean | Synchronous bridge call, not key-to-pixel latency |
| Resize dispatch | 7.7 microseconds mean | Synchronous bounds submission, not completed reflow |
| Hide, show, focus dispatch | 0.45 ms | Attachment command submission, not crash recovery |
| CPU during five-second output window | 2,050.2 ms user, 641.0 ms system | Whole Electron main process and native terminal threads |
| Private memory after output | +103,344 KiB | Whole main-process private memory relative to pre-surface baseline |
| Destroy dispatch | 1.38 ms | View removal and release request only |
| Private memory two seconds after destroy | +60,944 KiB | Memory had not returned to the pre-surface baseline |
| Per-surface GPU memory | unavailable | Electron and libghostty expose no usable per-surface value |
| Presented output rate | unavailable | No presented-output watermark exists |

The CPU and memory numbers are characterization, not a renderer comparison. The test cannot tell when the 32 MiB reached the screen. It cannot separate Electron, Swift, Ghostty, IOSurface, font, and GPU allocations. The retained 60 MiB is enough to block a claim of memory convergence. Repeated multi-surface cycles are still required.

## Renderer-visible completion

The probe emitted these lifecycle events:

```json
{"event":"host-started"}
{"event":"renderer-loaded"}
{"event":"surface-created","startupMs":414.7,"surfaceID":"1","rendererWatermark":"unavailable"}
```

`surface-created` proves that the AppKit view and Ghostty surface were allocated. It does not prove that a Metal frame was presented. Electron's `capturePage()` captures web contents and omits the native sibling view. OS window capture also depends on Screen Recording permission. Neither path ties pixels to a terminal output sequence.

Current full libghostty exposes renderer health and draw controls, but no callback that associates a presented frame with an input byte offset or OpenForge sequence. The renderer conformance and performance gates cannot use sleeps as a substitute.

## Conformance status

| Criterion | Status | Evidence or blocker |
| --- | --- | --- |
| Full native Ghostty renderer | narrow pass | Real Metal, IOSurface, CoreText, and Ghostty state path created |
| One parser and protocol-reply owner | pass inside probe | Ghostty owns parser, PTY, and replies; OpenForge sidecar is not involved |
| OpenForge snapshots and sequenced replay | blocked | Full surface API has no host checkpoint import or export and no external PTY byte input |
| Stale PTY and attachment rejection | contract-only pass | Pure contract tests reject wrong session, instance, and generation; native bridge is not wired to production IDs |
| Unicode width, graphemes, shaping, fallback | not measured | Native CoreText path exists, but no screenshot and watermark conformance runner exists |
| ANSI styles and alternate screen | not measured | Full core supports them; output completion is unobservable |
| Keyboard layouts and IME | structural evidence only | AppKit wrapper implements first responder and text input; no composition test ran |
| Selection and clipboard | structural evidence only | Full API exposes selection and clipboard callbacks; OpenForge policy was not wired |
| Links | structural evidence only | Full API emits open-URL actions; `openUrl()` policy was not wired |
| Mouse reporting | structural evidence only | Full API accepts position, button, scroll, pressure, and capture state |
| Resize and HiDPI | partial | Frame dispatch and AppKit backing-scale path worked; completed reflow was not observable |
| Detach and reattach | partial | Hide and show retained the surface; cross-window reparenting did not run |
| Multiple terminals | not run | API permits multiple surfaces, but scheduler, GPU, and memory behavior remain unknown |
| Images and custom glyphs | not run | Full core and renderer own both; the prebuilt probe disables custom shaders, not image or glyph protocols |
| Accessibility | fail | Probe wrapper has no AppKit terminal accessibility tree |
| Helper crash recovery | fail | Libghostty runs in Electron's main process |
| Deterministic disposal | fail | Destroy returned, but private memory remained about 60 MiB above baseline after two seconds |
| Offline package | fail | SwiftPM downloaded the binary and resources; no staged offline Electron package was produced |
| Signing and notarization | fail | Artifacts are arm64 and ad-hoc signed only |

## Electron host mechanisms considered

### In-process native subview

This is the implemented probe. It has the shortest path to Ghostty application rendering, AppKit focus, IME, selection, and native accessibility APIs. It also has the worst failure boundary. A fault or ABI mismatch can terminate Electron's main process. Electron does not promise that third-party subviews inserted under its window handle will survive compositor hierarchy changes.

### Native addon in the renderer process

This retains an in-process crash boundary, conflicts with sandboxing, and gives renderer JavaScript a native pointer path. It does not solve tab reparenting, checkpoint ownership, or presentation acknowledgements.

### Separate native overlay window

This isolates crashes but loses dependable clipping and stacking with Electron content. Focus, key-window ownership, IME candidate placement, accessibility order, Spaces, Mission Control, and cross-window tab movement all become window-manager coordination problems.

### Helper process and shared IOSurface

This is the only credible production host. A helper owns libghostty and renders offscreen into an IOSurface. Electron presents the shared surface while the host proxies input, IME, accessibility, frame lifetime, and output watermarks. Current full libghostty does not expose the required offscreen target or frame protocol. Adding them would be a Ghostty API project, not a small OpenForge adapter.

## Requested feature conclusions

- Session and presentation policy must remain host-owned and shared by agent and regular plugin terminals.
- Full Ghostty must become the sole parser and terminal protocol-reply producer for a native PTY instance. Keeping sidecar libghostty-vt authoritative would duplicate state and replies.
- Native failure can fall back to xterm only before PTY creation. Runtime fallback requires a new PTY generation until compatible checkpoints exist.
- Theme and configuration propagation should send one resolved, revisioned Ghostty config from the host. Surfaces must not independently read mutable user files.
- Fonts and fallback must use the packaged CoreText path and a declared font policy. Browser fallback is irrelevant to the native view.
- Images and Ghostty custom glyphs must stay in the same authoritative Ghostty core and renderer. Mirroring bytes through another parser is forbidden.
- Clipboard reads, OSC 52 confirmation, link opening, and notifications must cross explicit policy callbacks. Native code must not bypass OpenForge's external-URL and permission rules.
- Tab reparenting needs logical identity, native window identity, bounds, scale, focus, visibility, generation, and completion. Hide and show are not enough.
- Disposal needs an acknowledgement after terminal, PTY, render thread, IOSurface, fonts, callbacks, and view references are gone.

## Result

The probe answers the narrow question: a full native Ghostty surface can appear inside an Electron window on macOS.

It also exposes why that is not the product decision. The current API makes the smallest visual integration the largest ownership and reliability regression. OpenForge should keep xterm and pursue the seven gated slices in ADR 0004 only after upstream provides the missing contracts.
