# Web terminal renderer options after the Ghostty state cutover

Research date: 2026-08-24

> Current production authority is defined by [ADR 0004](adr/0004-xterm-authoritative-terminal-mode.md). xterm owns parsed state and query responses. Sidecar-authoritative snapshots and sequenced model frames in this research document are prospective.

## Decision in one page

OpenForge should not build a browser terminal renderer from scratch yet. There are now several credible web renderers built around native terminal engines, and official `libghostty-vt` has advanced far enough that it can supply the browser-side terminal model directly.

My recommendation is:

1. Keep the Rust sidecar as the authoritative terminal model.
2. Introduce a renderer-neutral `TerminalView` interface in Terminal Runtime.
3. Build a short-lived `WtermTerminalView` experiment using `@wterm/dom` and stock `@wterm/ghostty`.
4. If the interaction model works, replace stock `@wterm/ghostty` with an OpenForge-owned adapter over official `libghostty-vt` WASM, pinned to the same Ghostty revision as the Rust sidecar.
5. Keep xterm as the production fallback until performance, inline images, accessibility, packaging, and protocol replies pass explicit gates.

The strongest alternative is restty. It already has a WebGPU renderer, a WebGL2 fallback, text shaping, IME handling, search, and Kitty graphics. Its main drawback is dependency risk: it vendors a modified Ghostty fork and a separate text-shaper project, and it has much less adoption than wterm or ghostty-web.

Official libghostty is not an official web terminal widget. It now provides most of the low-level pieces needed to build one, including render state, dirty rows, selection, key and mouse encoders, Kitty graphics access, snapshots, and WASM allocation helpers. Ghostty's official browser example still formats terminal state as plain text. The graphical browser renderer remains our responsibility or a third-party dependency.

## Assumption

I assume "libcocci" meant `libghostty`. If it refers to another project, this document needs another candidate section.

## What OpenForge has today

The current experimental path is:

```text
PTY bytes
  -> Rust libghostty-vt model, authoritative
  -> portable VT snapshot + output watermark
  -> sequenced raw frames
  -> xterm graphical view
```

This already gives OpenForge the hard lifecycle properties:

- The model exists outside the renderer.
- A disposable view can bootstrap from a snapshot.
- Sequence gaps cause a resnapshot.
- Model failures fall back to legacy xterm behavior.
- The cutover applies only to newly created Terminal Sessions.

The remaining xterm responsibilities are substantial:

- WebGL and default rendering
- Fit and resize behavior
- Keyboard, IME, paste, and mouse encoding
- Selection and copy
- Link detection and activation
- Cursor and focus behavior
- Scrollback
- iTerm2 inline images, including OpenForge's validation and resource limits
- Terminal-generated protocol replies through `onData`

Replacing xterm means replacing all of those behaviors, not merely drawing cells.

## The important libghostty finding

Ghostty's current `main` branch is much further along than the public WASM example suggests.

At commit `89d17b378ed9c9d68a82ab2359cfa8030f8ff4f9`, the public C headers include:

- `render.h` for render-state updates, row access, dirty-row iteration, cursor state, and packed cell reads
- `screen.h` for cell and row access
- `selection.h` for gestures, word and line selection, select-all, and formatted selection output
- `key/encoder.h` and `mouse/encoder.h` for terminal-aware input encoding
- `kitty_graphics.h` for image data, placements, viewport geometry, and animation frames
- `snapshot.h` for canonical snapshots
- `wasm.h` for host allocations and opaque handles in WebAssembly

OpenForge's pinned Ghostty commit, `22d13172cde98a0a4dda05d3d6a3fcb0dd8ed018` from 2026-08-06, already contains these interfaces. It predates several useful changes made later in August:

- Faster WASM render-state reads and updates
- Structured cursor reads
- Dedicated dirty-row iteration and clearing
- Packed cell layout access
- Current animation-frame access for Kitty graphics

Ghostty is also working on WASM memory use. PR 13865 reports the following benchmark for an 80x24 terminal with 1,000 lines of scrollback after processing 16 MiB of plain ASCII:

| Scenario | Before | After |
|---|---:|---:|
| First terminal, incremental memory | 3.44 MiB | 0.88 MiB |
| One filled terminal, total WASM memory | 4.00 MiB | 1.88 MiB |
| Each additional filled terminal | 3.00 MiB | 0.44 MiB |
| Five filled terminals, total WASM memory | 16.00 MiB | 4.06 MiB |

These are upstream author measurements, not OpenForge measurements. The PR is assigned to the open Ghostty 1.4 milestone, so the result should not be treated as a released guarantee.

### Pros of using official libghostty directly

- The browser and Rust sidecar can run the same VT implementation at the same pinned revision.
- Native snapshots may eventually move directly between the authoritative model and the browser replica.
- The render interface exposes dirty rows instead of forcing a full-grid conversion every frame.
- Key, mouse, selection, and graphics interfaces reduce the amount of terminal behavior OpenForge must invent.
- Ghostty has a large contributor base and extensive terminal compatibility work.
- The MIT license is compatible with OpenForge's dependency model.

### Cons of using official libghostty directly

- There is no official JavaScript package or finished graphical browser renderer.
- The public C interface is changing quickly. Several relevant interfaces changed in the ten days before this research.
- The official WASM example only demonstrates parsing and plain-text formatting.
- Ghostty's production GPU renderer uses Metal on macOS and OpenGL on Linux. It is not a browser WebGL or WebGPU renderer that can be dropped into Electron.
- OpenForge would own JavaScript bindings, text shaping, glyph atlases, paint scheduling, accessibility, IME integration, and browser resource recovery unless it combines libghostty with another renderer.
- Building directly on fresh C interfaces raises maintenance cost every time the pinned Ghostty revision changes.

### Conclusion on official libghostty

Official libghostty is now a credible engine and render-state source for the browser. It is not yet a complete web terminal. The best use of it is underneath a renderer with a narrow interface, not as a reason to build every browser interaction ourselves.

## Candidate comparison

Versions and activity below are a point-in-time snapshot from 2026-08-24. Download counts cover 2026-07-25 through 2026-08-23 and should not be confused with verified production deployments.

| Candidate | Current package | Renderer | Terminal core | GitHub stars | Monthly npm downloads | Main concern |
|---|---:|---|---|---:|---:|---|
| Current xterm path | `@xterm/xterm` 6.0.0 | DOM/canvas, optional WebGL | xterm.js | 21,088 | 15,144,648 | Does not complete the Ghostty view migration |
| wterm | `@wterm/dom` 0.3.4 | DOM rows | Built-in Zig or Ghostty WASM | 3,402 | 185,638 | No image support found; stock Ghostty WASM is slow in one third-party benchmark |
| ghostty-web | `ghostty-web` 0.4.0 | Canvas | Ghostty WASM | 2,741 | 2,515,168 | Old Ghostty pin, weak accessibility story, no image support found |
| restty | `restty` 0.2.6 | WebGPU, WebGL2 fallback | Modified libghostty-vt WASM | 394 | 4,685 | Modified Ghostty fork and separate shaping stack |
| rioterm | `rioterm` 0.1.8 | Canvas or DOM | Rio's Rust engine | 16 | 34,552 | Very new and not Ghostty-based |
| OpenForge custom renderer | Not applicable | Our choice | Official pinned libghostty-vt | Not applicable | Not applicable | Highest engineering and maintenance cost |

All listed projects use MIT or Apache-2.0 licenses.

## Option 1: wterm

Repository: <https://github.com/vercel-labs/wterm>

wterm separates its browser renderer from its parser through a synchronous `TerminalCore` interface. `@wterm/dom` renders mounted DOM rows and provides input handling. `@wterm/ghostty` implements the same interface using Ghostty compiled to WASM.

The DOM renderer provides native browser selection, clipboard behavior, find-in-page, and screen-reader access to mounted rows. It also implements dirty-row rendering, alternate-screen behavior, bounded scrollback, hyperlinks, grapheme strings, automatic resize, synchronized output, mouse reporting, and focus reporting.

### Pros

- It has the cleanest renderer/core separation among the candidates.
- `WTermOptions.core` accepts a preconstructed `TerminalCore`, so OpenForge can replace the stock Ghostty core without replacing the DOM renderer.
- DOM rows give selection, browser find, and accessibility a stronger base than a canvas plus hidden accessibility mirror.
- The integration model matches the current OpenForge attachment protocol: write a portable snapshot, then write sequenced raw frames.
- It has active development, browser end-to-end tests, and more adoption than restty.
- Its Apache-2.0 license permits an OpenForge adapter or maintained fork.
- Its renderer does not require React and can sit behind a Svelte-facing adapter.

### Cons

- I found no Kitty, Sixel, or iTerm2 image implementation in its renderer or tests.
- `@wterm/ghostty` 0.3.4 builds Ghostty 1.3.1 instead of OpenForge's pinned revision.
- Its Ghostty package applies WASM compatibility patches and builds with Zig `ReleaseSmall`.
- The package documentation requires a separately fetched WASM asset and warns that some bundlers leave an invalid build-machine `file:` URL. Electron packaging needs explicit testing.
- A benchmark published by the rioterm author measured the wterm Ghostty core at roughly 1 to 2 MiB/s for parsing and painting, compared with 108 to 178 MiB/s for xterm WebGL in the same workloads. This is a competitor-authored benchmark and must be reproduced before relying on it.
- DOM rendering may become expensive with many visible terminals or unusually large rows, even with windowed scrollback and dirty-row updates.
- Its `onData` path includes both user input and terminal-generated replies. OpenForge must separate those before the Rust sidecar can become the sole reply authority.

### OpenForge fit

Good, provided we treat stock `@wterm/ghostty` as a prototype dependency rather than the final engine. The production version should implement wterm's `TerminalCore` over an OpenForge-built official Ghostty WASM module pinned to the same revision as the sidecar.

## Option 2: ghostty-web

Repository: <https://github.com/coder/ghostty-web>

ghostty-web aims to replace `@xterm/xterm` with an xterm-shaped interface. It uses Ghostty WASM and a canvas renderer. This gives it the lowest apparent migration cost.

### Pros

- The xterm-shaped interface could reduce changes in `terminalPool.ts` and Terminal Runtime.
- It already implements a canvas renderer, selection, IME composition handling, and familiar terminal lifecycle methods.
- Its npm download count is much larger than the other new Ghostty web packages.
- It has zero runtime dependencies and uses the MIT license.
- A canvas renderer should avoid the DOM-node volume of a row-based renderer.

### Cons

- Version 0.4.0 pins Ghostty commit `5714ed07a1012573261b7b7e3ed2add9c1504496` from 2025-12-01. It predates the current official render, selection, graphics, input, and WASM APIs.
- It carries a large patch that exposes its own Ghostty WASM interface.
- The published package has not changed since 2025-12-09, despite later repository activity.
- I found no Kitty, Sixel, or iTerm2 image implementation.
- Accessibility appears limited to ARIA on the input element. A canvas renderer needs a maintained text representation for screen readers and browser find.
- API compatibility claims do not mean addon compatibility. OpenForge's image, WebGL, links, and fit addons would still need replacement or verification.
- The unpacked npm package is approximately 2.2 MiB.

### OpenForge fit

Useful as a fast experiment, but weaker than wterm as a long-term dependency. Its main advantage is migration convenience, and that convenience may disappear once OpenForge removes concrete xterm types from Terminal Runtime.

## Option 3: restty

Repository: <https://github.com/wiedymi/restty>

restty is the most ambitious Ghostty web renderer found in this research. It combines libghostty-vt WASM with WebGPU, a WebGL2 fallback, TypeScript text shaping, glyph atlases, a hidden IME input, search, themes, plugins, multiple panes, and an xterm compatibility wrapper.

### Pros

- It already implements the GPU renderer that wterm and ghostty-web do not have.
- It has explicit WebGPU and WebGL2 implementations.
- Its architecture reads Ghostty render state and paints backgrounds, glyphs, decorations, selection, and cursor state.
- It has explicit IME tests and accessibility attributes for pane input.
- It includes Kitty graphics parsing, placement, caching, and tests.
- It has headless and xterm-compatibility entry points.
- It builds WASM in `ReleaseSafe` by default rather than `ReleaseSmall`.
- The source tree has broader tests than the other new candidates, including rendering, graphics, IME, search, headless operation, and fallback behavior.

### Cons

- It vendors `wiedymi/ghostty`, a modified fork of upstream Ghostty. The pinned fork commit adds WASM Kitty graphics support.
- It also depends on a separate `wiedymi/text-shaper` project.
- Adopting it means trusting two small projects in addition to Ghostty itself.
- Its public package is 0.2.6, the repository has fewer than 400 stars, and npm reported 4,685 downloads in the measured month.
- The unpacked npm package is approximately 9.3 MiB.
- WebGPU behavior and driver quality vary. The WebGL2 fallback reduces this risk but doubles renderer paths that need testing.
- Kitty graphics do not prove compatibility with OpenForge's current iTerm2 inline-image protocol.
- Canvas and GPU rendering still need an accessibility strategy beyond an input element and search UI.
- Adapting it to a sidecar-authoritative snapshot and watermark protocol may require more changes than wterm's small `TerminalCore` interface.

### OpenForge fit

Technically strong, operationally risky. It deserves a bake-off against wterm if wterm's DOM performance or lack of images fails the prototype. I would not make its Ghostty fork authoritative in OpenForge.

## Option 4: rioterm

Repository: <https://github.com/raphamorim/riotermjs>

rioterm compiles Rio's Rust terminal engine to WASM and offers canvas and DOM renderers. It claims built-in search, links, clipboard, Kitty graphics, input handling, and xterm-shaped migration.

### Pros

- It offers both canvas and DOM renderers over one engine.
- Its published benchmark reports much higher throughput than xterm and wterm.
- It claims Kitty graphics support and an xterm migration path.
- Its underlying engine shares code with the Rio desktop terminal.
- The MIT license is compatible.

### Cons

- It is not Ghostty-based, so adopting it creates three terminal models during migration: native Ghostty, browser Rio, and xterm fallback.
- The repository was created on 2026-08-08 and had 16 stars at research time.
- Version 0.1.8 is too new to establish compatibility or maintenance history.
- The performance comparison was published by the project author. It is useful evidence for a local benchmark plan, not a neutral result.
- OpenForge would still need to prove snapshot reconstruction compatibility across different terminal engines.

### OpenForge fit

Low. It may become a strong general xterm replacement, but it works against the decision to standardize terminal behavior on Ghostty.

## Option 5: build directly on official libghostty

This option compiles OpenForge's pinned Ghostty revision to WASM, reads the official render-state interface, and implements a renderer inside Terminal Runtime.

### Pros

- Exact engine parity between Rust and browser.
- No third-party parser fork or stale Ghostty pin.
- Direct access to dirty rows, selection, input encoders, graphics, and snapshots.
- OpenForge controls performance tradeoffs, CSP behavior, packaging, and failure handling.
- Native snapshots could replace portable VT once browser and sidecar builds use the exact same revision and options.

### Cons

- OpenForge would own a terminal renderer, font fallback, shaping, glyph caches, IME behavior, accessibility, scrollback interaction, selection, links, graphics, and GPU recovery.
- A correct renderer is a permanent subsystem, not a one-time migration task.
- Fresh libghostty interface changes would directly affect OpenForge.
- Testing would need to cover rendering across operating systems, display scaling, fonts, GPUs, and accessibility tools.
- This has the longest route to production and the largest maintenance burden.

### OpenForge fit

Excellent engine fit, poor initial delivery cost. Use this only if the renderer layers from wterm and restty cannot meet OpenForge's requirements.

## Option 6: keep xterm as the graphical view

The current design can be a valid long-term architecture. A renderer-side replica does not become authoritative merely because it parses output. The Rust Ghostty model still decides recovery state and attachment sequencing.

### Pros

- Lowest risk.
- Existing WebGL, iTerm2 images, links, selection, IME, accessibility, and Electron behavior remain intact.
- xterm has a decade of adoption and a large addon ecosystem.
- The new sidecar model already fixes renderer-loss and reconnect behavior.
- No second migration is required to ship the state-ownership improvements.

### Cons

- Terminal behavior is still parsed by two different engines.
- Ghostty protocol replies remain captured while xterm supplies replies.
- Snapshot formatting must remain portable to xterm.
- Parser differences can still appear between initial Ghostty state and later xterm state.
- OpenForge retains the xterm dependency and its renderer-specific lifecycle code.

### OpenForge fit

Best short-term production choice. It should remain the fallback until another renderer proves parity.

## Architecture choice: browser replica or sidecar projection

Any non-xterm renderer still requires one architectural decision.

### Browser Ghostty replica

```text
Rust Ghostty model
  -> native or portable snapshot
  -> sequenced raw frames
  -> browser Ghostty WASM replica
  -> renderer
```

Pros:

- Reuses the protocol already implemented for xterm.
- Keeps terminal-specific render state inside Ghostty.
- Avoids an OpenForge-specific cell and styling protocol.
- Allows the view to read cells synchronously during paint.
- A sequence gap still recovers from the authoritative sidecar.

Cons:

- Parses every byte twice.
- Uses memory for a native model and a WASM model per active terminal.
- Protocol replies must be emitted by the sidecar and discarded in the replica.
- Native snapshots require exact Ghostty build compatibility.

### Sidecar render projection

```text
Rust Ghostty model
  -> packed render snapshot and dirty-row patches
  -> browser row cache
  -> renderer
```

Pros:

- Only one terminal parser and model.
- Protocol replies naturally remain in the sidecar.
- Browser code holds only render data.
- Uses the sidecar's exact cell, selection, cursor, and graphics interpretation.

Cons:

- Requires a new OpenForge render protocol.
- Dirty-row and scrollback updates must cross Electron IPC efficiently.
- The browser must maintain a coherent local cache anyway.
- Renderer libraries generally expect a synchronous core interface, so OpenForge needs an adapter over that cache.
- The protocol becomes another compatibility contract to maintain.

### Recommendation

Start with a browser Ghostty replica. It is simpler and preserves the working snapshot and sequence design. Measure CPU and memory with several concurrent terminals. Move to sidecar render projection only if duplicate parsing or memory is a demonstrated problem.

## Recommended experiment

### Phase 1: renderer interface

Introduce a narrow `TerminalView` interface and put the current xterm code behind `XtermTerminalView`. Do not expose xterm types through `PoolEntry`, attachment, or controls.

Required operations should cover:

- Mount and dispose
- Apply bootstrap bytes
- Apply sequenced live bytes
- Focus and reset
- Resize and measured geometry
- User-input callback
- Selection text
- Theme updates
- Renderer failure callback

### Phase 2: wterm prototype

Add `WtermTerminalView` under a second persisted setting, default off.

Use stock `@wterm/dom` and `@wterm/ghostty` only for the first experiment:

- Feed the existing portable VT bootstrap.
- Feed only frames after the watermark.
- Use the existing gap and fallback behavior.
- Keep xterm available for the same Terminal Session after renderer initialization failure.
- Package the WASM asset explicitly rather than relying on `import.meta.url` behavior.

### Phase 3: OpenForge Ghostty core adapter

If the prototype passes interaction tests, replace stock `@wterm/ghostty` with an adapter that implements wterm's `TerminalCore` interface over an OpenForge-built official Ghostty WASM module.

Requirements:

- Use the same pinned Ghostty revision as the Rust sidecar.
- Use the official render-state, screen, selection, key, mouse, graphics, snapshot, and WASM interfaces.
- Benchmark `ReleaseFast`, `ReleaseSafe`, and `ReleaseSmall` rather than accepting another project's build choice.
- Drain and discard browser-generated protocol replies once the Rust sidecar forwards its own ordered replies.
- Keep the adapter private to Terminal Runtime so wterm can be replaced without changing callers.

### Phase 4: restty bake-off if needed

Run the same workloads against restty if:

- wterm misses the frame-time target,
- DOM memory is too high,
- inline graphics cannot be added cleanly, or
- font shaping is visibly worse than the current view.

Do not adopt restty's modified Ghostty fork as OpenForge's authoritative version. A production restty integration would need either upstream Ghostty support or a maintained OpenForge pin with a small, audited patch set.

## Acceptance gates

A replacement should not become default until it passes all of these.

### Correctness

- Portable and native snapshot bootstrap
- Sequence-gap recovery
- Renderer disposal and reattachment
- Shell prompts and command editing
- `vim`, `less`, `tmux`, `htop`, Claude Code, and Codex TUIs
- Alternate screen and synchronized output
- Bracketed paste and application cursor keys
- Mouse press, drag, release, wheel, and focus reporting
- Unicode graphemes, emoji ZWJ sequences, combining marks, CJK width, Arabic, and Devanagari
- Hyperlinks and safe external URL routing through `openUrl()`
- Selection, copy, browser find or equivalent search, and scrollback anchoring
- iTerm2 inline images with OpenForge's byte, pixel, decode-time, and storage limits
- macOS, Linux, and Windows packaged builds without network access

### Authority and ordering

- User input and terminal-generated replies use separate paths.
- Ghostty replies enter one ordered PTY writer in the sidecar.
- The browser replica never forwards its own query replies.
- A renderer failure affects only the matching Shell Session Key and PTY instance.
- Stale instance frames cannot mutate a new view.

### Performance

Measure against the current xterm WebGL path using the same OpenForge build:

- Cold initialization
- Time to first interactive snapshot
- Plain output throughput
- ANSI-heavy output throughput
- Full-screen TUI frame-time p50 and p95
- Scrollback memory at 1,000, 10,000, and 100,000 lines
- Total memory for 1, 5, and 10 active terminals
- Resize latency
- Recovery latency after a synthetic sequence gap
- Main-thread blocking during agent output bursts

A candidate should not regress visible TUI frame-time p95 or time to first interaction. Any memory or throughput regression needs an explicit product reason.

### Accessibility

- Keyboard-only focus path remains intact.
- Screen readers announce terminal content and cursor movement usefully.
- IME composition works without duplicate or dropped text.
- Selection remains native or has equivalent keyboard controls.
- High-contrast themes and minimum contrast behavior remain available.
- Canvas-only renderers need a tested accessibility representation, not only an ARIA label on the hidden input.

## Recommendation and decision points

### Recommended now

Keep the current xterm renderer in production. Start the renderer-neutral interface and a wterm prototype behind a separate setting.

### Adopt wterm's renderer if

- The DOM renderer meets OpenForge's frame-time and memory targets.
- An official pinned Ghostty WASM adapter is practical.
- iTerm2 image support can be retained or replaced without weakening safety limits.
- Electron packaging and CSP behavior are deterministic and offline.

### Prefer restty if

- wterm fails performance or shaping tests,
- GPU rendering is required for realistic OpenForge workloads, and
- OpenForge is willing to own or upstream the Ghostty and text-shaper integration work.

### Build a custom renderer only if

- Both renderer projects fail concrete acceptance gates,
- the failure cannot be fixed upstream at reasonable cost, and
- terminal rendering is important enough to justify a permanent graphics subsystem.

### Do not choose yet

- ghostty-web, until it updates to current official libghostty interfaces and demonstrates image and accessibility parity.
- rioterm, until it has a longer compatibility record and there is a reason to reverse the Ghostty standardization decision.

## Sources

### Official Ghostty and libghostty

- Ghostty repository and libghostty status: <https://github.com/ghostty-org/ghostty>
- "Libghostty Is Coming," Mitchell Hashimoto, 2025-09-22: <https://mitchellh.com/writing/libghostty-is-coming>
- Official WASM VT example: <https://github.com/ghostty-org/ghostty/tree/main/example/wasm-vt>
- Current render interface: <https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt/render.h>
- Current screen interface: <https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt/screen.h>
- Current selection interface: <https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt/selection.h>
- Current key encoder: <https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt/key/encoder.h>
- Current mouse encoder: <https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt/mouse/encoder.h>
- Current Kitty graphics interface: <https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt/kitty_graphics.h>
- Current WASM helpers: <https://github.com/ghostty-org/ghostty/blob/main/include/ghostty/vt/wasm.h>
- WASM memory optimization PR 13865: <https://github.com/ghostty-org/ghostty/pull/13865>
- Cross-platform libghostty discussion 9411: <https://github.com/ghostty-org/ghostty/discussions/9411>

### Renderer candidates

- wterm repository: <https://github.com/vercel-labs/wterm>
- wterm Ghostty package: <https://wterm.dev/ghostty>
- ghostty-web repository: <https://github.com/coder/ghostty-web>
- restty repository: <https://github.com/wiedymi/restty>
- restty documentation: <https://restty.pages.dev/docs/getting-started>
- rioterm repository: <https://github.com/raphamorim/riotermjs>
- rioterm release and benchmark: <https://rioterm.com/blog/2026/08/10/riotermjs-rio-terminal-for-the-web>
- xterm.js repository: <https://github.com/xtermjs/xterm.js>

### Point-in-time metadata

- GitHub repository metadata came from the public GitHub API on 2026-08-24.
- npm versions, unpacked sizes, and download counts came from the public npm registry and npm downloads API on 2026-08-24.
- Source-level feature checks used these commits:
  - wterm `cdff1c07890ab2c5ba2efbcc1091f790dfb8f931`
  - ghostty-web `1858a5947767a3e1c9e98dbf53b2ff87fedb2aab`
  - restty `7700b14a7643ba9240818209ef1e0aa90d83ad77`
  - rioterm `dff18e2d323f5404a9483fcfce754538f6975ca6`
  - Ghostty `89d17b378ed9c9d68a82ab2359cfa8030f8ff4f9`

## Research caveats

- Feature claims from project READMEs are not proof that they work under OpenForge workloads.
- The rioterm benchmark is published by a competing project. It is useful for identifying a risk in wterm's `ReleaseSmall` Ghostty build, but OpenForge should reproduce it.
- GitHub stars, issue counts, and npm downloads measure attention and distribution, not correctness.
- No candidate documentation demonstrated OpenForge's exact iTerm2 inline-image behavior and resource limits.
- Official Ghostty `main` changes quickly. Any implementation decision must pin a revision and review the diff before upgrading.
