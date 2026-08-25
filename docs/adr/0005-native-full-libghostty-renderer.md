# Do not adopt the full libghostty renderer yet

Status: accepted

Date: 2026-08-25

Task: KVG-4003

## Decision

OpenForge will not ship a full libghostty renderer on the current upstream API. Xterm remains the desktop renderer. The native probe was discarded after these findings were recorded; no prototype code or build artifact is retained in the repository.

The result is a no-go, not a rejection of Ghostty's renderer. The probe created a real Metal and CoreText terminal view inside an Electron window. The blocked part is the product boundary around that view. Current full libghostty cannot preserve OpenForge's session ownership, snapshots, sequenced replay, scoped fallback, and crash isolation at the same time.

We will reconsider this decision when full libghostty has a supported embedding API that covers host-managed I/O, snapshot import and export, renderer presentation acknowledgements, deterministic shutdown, and an offscreen or cross-process render target.

## API evaluated

The current API audit pins Ghostty commit `557253d8f64f8b08da33f5a7f3cb33a75960b09d` from 2026-08-25 and Zig 0.16.0.

`include/ghostty.h` describes itself as `libghostty-internal`. It says the macOS application is its only consumer and directs external embedders to `libghostty-vt`. Its surface API accepts an `NSView`, starts a command and PTY, processes keyboard and mouse input, manages selection and clipboard requests, and renders through Metal. It does not accept an existing PTY byte stream. It does not import or export full-surface checkpoints. It does not acknowledge that output through a given sequence has reached a displayed frame.

`libghostty-vt` is not this API. It is the documented C and Zig library under `include/ghostty/vt/`. It parses terminal bytes and owns terminal state. It has no Ghostty application renderer, CoreText font fallback, Metal renderer, image presentation, native input view, or PTY process owner. Using it behind a DOM, canvas, or WASM renderer would repeat the wterm mistake.

The runnable probe pins Ghostty v1.3.1 commit `332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28` through `libghostty-spm` 1.4.0 at commit `356f730bec03281fc7b83666a129b0246137ea26`. That package ships a checksum-verified full renderer but patches upstream and disables custom shaders and the inspector. It proves native view hosting. It is not evidence that current unmodified upstream meets the product contract.

## Required ownership model

Any future native implementation must use this ownership split:

- `TerminalSessionService` is host-owned and shared by agent terminals and regular Terminal plugin terminals. It owns Shell Session Keys, PTY-instance generations, attachment generations, lifecycle policy, geometry leases, sequence allocation, recovery policy, and fallback decisions.
- One Ghostty surface owns the authoritative parser and terminal state for one Shell Session Key and PTY instance.
- The same Ghostty surface is the only producer of terminal protocol replies for that PTY instance. The host may transport those bytes but must not derive competing replies from a second parser.
- Companion views and diagnostics may observe sanitized output. They cannot become another reply owner.
- A sidecar `libghostty-vt` model cannot remain authoritative beside a full Ghostty surface. At most it may be a reply-disabled diagnostic observer.

Current upstream full libghostty owns its own PTY but does not expose enough output and checkpoint data for OpenForge replay and companion clients. A patched host-managed I/O backend can transport bytes through OpenForge, but then OpenForge must remove its authoritative parser and route Ghostty's generated replies to the PTY. The patch is not upstream API.

Fallback is scoped to a Shell Session Key and PTY generation. A native preparation or startup failure may choose xterm before spawning the PTY. A running Ghostty session cannot switch to xterm in place because current full libghostty cannot export a checkpoint that xterm can restore. Runtime failure must terminate that PTY generation and offer a new xterm-backed generation. Silent byte replay into another live parser is forbidden.

## Native attachment contract

`mount(HTMLElement)` is not a native attachment contract. A future contract must carry:

- Shell Session Key, PTY instance ID, logical surface ID, attachment ID, and attachment generation
- owning OpenForge window and native host handle
- renderer bounds in CSS pixels, native backing bounds, scale factor, and display ID
- visible, occluded, focused, composing, suspended, and detached states
- geometry lease and resize acknowledgement
- reparent request and completion when a tab moves between windows
- renderer readiness and the highest presented output watermark
- explicit disposal request and completion

Every command must reject the wrong Shell Session Key, stale PTY instance, or stale attachment generation. Tab detach retains the logical session but removes the native view. Reattach may target another window. Disposal belongs to logical session ownership and must not depend on Svelte effect cleanup.

## Renderer completion

Surface creation is not renderer readiness. A valid ready event must prove all of the following:

1. The native library and resources loaded.
2. The view attached at the requested scale and bounds.
3. The renderer created its Metal resources.
4. The initial checkpoint or output prefix reached a presented frame.
5. The acknowledgement names the Shell Session Key, PTY instance, attachment generation, and output watermark.

The audited API exposes renderer health but no presented-output watermark. The probe therefore records `rendererWatermark: "unavailable"`. Timers, animation-frame counts, and "surface created" callbacks cannot replace this acknowledgement.

## Host and crash isolation

The discarded probe inserted an `NSView` under Electron's native window handle from a N-API addon. This gave correct native font shaping, input-method participation, and Metal rendering. It also ran libghostty and its terminal threads in Electron's main process. A native fault would take down the application. Electron does not support arbitrary third-party subviews as a stable public extension point.

Other host mechanisms do not close the gap:

- A renderer-process addon conflicts with sandboxing and moves the crash into the renderer without fixing reparenting or checkpoint ownership.
- A separate borderless native window cannot reliably match Electron clipping, stacking, Spaces, focus, IME, accessibility, or tab movement.
- A helper that renders into a shared IOSurface is the best isolation design. It needs a supported offscreen render target, a frame and watermark protocol, input and accessibility proxies, and explicit IOSurface lifetime. Current full libghostty only accepts a native view and creates its own IOSurface-backed layer.

Production work is blocked on the helper and shared-IOSurface option. In-process embedding is not an acceptable crash boundary.

## Preparation and packaging contract

Native preparation must complete before OpenForge creates the logical session or PTY. It returns an immutable receipt containing:

- platform, architecture, minimum macOS version, Ghostty revision, wrapper revision if any, and Zig version
- hashes for every native library, shader or metallib, font, theme, terminfo entry, shell-integration file, and other runtime resource
- supported renderer capabilities and disabled Ghostty features
- final package-relative paths and expected code-signing identity
- successful library load and resource self-check results

A missing Metal toolchain, missing resource, hash mismatch, wrong architecture, invalid signature, or failed self-check is a pre-session failure. The host may choose xterm before PTY creation. It must not spawn a native PTY and then discover that the view cannot load.

Offline packages must contain all receipt files. Packaging signs nested native libraries and the helper before signing the Electron application. Verification must run `codesign --verify --deep --strict`, Gatekeeper assessment, packaged smoke tests on a clean machine with no network, and notarization plus stapling. The probe artifacts are only ad-hoc signed and do not satisfy this contract.

## Feature findings

- Focus and IME require a real AppKit first responder and `NSTextInputClient`. The probe wrapper supplies this path. A cross-process renderer would need an explicit IME protocol and candidate-rectangle updates.
- Selection, clipboard, and links exist in the full C API through selection reads, clipboard callbacks, actions, and open-URL actions. OpenForge must still apply its clipboard confirmation and `openUrl()` policies.
- Mouse input and alternate-screen mouse capture belong to the Ghostty surface. Electron must not also interpret terminal mouse reporting.
- Resize uses framebuffer pixels and backing scale. CSS bounds must be converted through the owning window and updated when the display changes.
- Theme and configuration updates can use cloned and finalized Ghostty configs. The host remains the policy owner and sends one resolved config revision to every surface.
- CoreText provides native shaping and fallback. Ghostty's custom glyph and image protocols stay in the one authoritative core and full renderer.
- The current C API can create multiple surfaces under one app. The probe did not prove scheduler behavior, GPU pressure, or memory convergence with multiple terminals.
- The probe wrapper has no AppKit terminal accessibility implementation. The official Ghostty app adds accessibility behavior above the C API. OpenForge would need an equivalent tree, selection, cursor, value-change notifications, and VoiceOver tests.

## Consequences

OpenForge keeps renderer-neutral behavior and does not weaken snapshot or sequence semantics to accommodate a renderer. Shell Session Key and PTY-instance checks remain mandatory. Stale generations stay rejected. Xterm fallback remains scoped and happens before session start or through a new PTY generation.

The experiment remains useful as recorded evidence. Its implementation was discarded so it cannot become an intermediary around xterm or wterm.

## Reconsideration slices

Run these slices in order. Stop at the first failed gate.

1. Upstream contract slice. Obtain or contribute supported host-managed I/O, snapshot import and export, presented-watermark, deterministic shutdown, and offscreen render-target APIs. No OpenForge renderer code ships from this slice.
2. Isolated helper slice. Render one surface to an IOSurface in a helper process. Kill and restart the helper without terminating Electron. Prove frame, input, IME, accessibility, and IOSurface disposal protocols.
3. Session-service slice. Put agent and regular plugin terminals behind one host-owned `TerminalSessionService`. Prove one parser and reply owner, sequence continuity, stale-instance rejection, and pre-spawn fallback.
4. Native attachment slice. Implement the generation-checked attachment contract, cross-window reparenting, display-scale changes, visibility, occlusion, and deterministic disposal.
5. Preparation slice. Produce an offline universal artifact, resource manifest, signatures, notarized package, clean-machine smoke test, and pre-session failure tests.
6. Conformance slice. Run Unicode width, graphemes, bidi and shaping cases, ANSI styles, OSC 8 links, selection, clipboard confirmation, keyboard layouts, IME, mouse reporting, alternate-screen applications, resize and reflow, images, custom glyphs, accessibility, detach and reattach, multiple terminals, helper crash recovery, and scoped fallback.
7. Performance slice. Measure presented startup, input-to-pixel latency, sustained output through a presented watermark, resize completion, recovery, CPU, per-helper GPU use, native memory convergence, and teardown across repeated sessions.

Only a pass on all seven slices can change this ADR to a go.
