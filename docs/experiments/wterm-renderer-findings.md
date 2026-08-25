# Findings from the wterm renderer experiment

Task: KVG-3952

## Status

The prototype code was removed. This document is the only artifact kept from the work.

The result was a no-go for wterm. The narrow integration worked, but it did not provide Ghostty application parity and did not justify replacing xterm.

The experiment used `@wterm/dom@0.3.4` and `@wterm/ghostty@0.3.4`.

## What the prototype covered

The prototype added wterm behind the renderer-neutral terminal view interface. It was disabled by default and selected only for newly created terminal sessions. Both agent terminals and regular Terminal plugin shells were exercised.

The adapter covered snapshot bootstrap, sequenced output, input, focus, selection, resize, theme changes, links, detach and reattach, reconnect recovery, and disposal of DOM resources. Renderer failures fell back to xterm for the matching shell session and PTY instance rather than changing every terminal.

The Ghostty WASM file was emitted as one stable local asset and included in the Electron package. Loading it from a packaged `file://` application was not verified in the available environment.

## Measurements

One run used headless Chromium 151 on macOS with a 1280 by 720 viewport. Both renderers came from the same production renderer build.

| Measurement | xterm | wterm |
|---|---:|---:|
| Cold initialization | 34.7 ms | 15.1 ms |
| Input dispatch to next paint | 4.6 ms | 15.2 ms |
| Output submission plus eight paints | 18.30 MiB/s | 1.76 MiB/s |
| Representative TUI frame | 16.7 ms | 16.8 ms |
| Alternating resize | 4.46 ms | 4.29 ms |
| Sequence recovery plus two paints | 41.2 ms | 50.6 ms |

These are comparison numbers, not complete rendering benchmarks. The terminal view interface had no renderer-owned completion signal. Output tests therefore waited for a fixed number of animation frames. The TUI result was limited by frame rate.

JavaScript heap readings were discarded as decision evidence. They excluded WASM linear memory, DOM backing stores, native allocations, and GPU memory.

## Reasons for the no-go

### The DOM renderer was not Ghostty's renderer

`@wterm/ghostty` supplied Ghostty terminal parsing through WASM. `@wterm/dom` still rendered browser DOM cells. Font choice, fallback, shaping, hinting, glyph metrics, ligatures, and rasterization remained browser behavior.

Terminal escape sequences carry characters and styles. They do not select Ghostty's normal font stack. Nerd Font tools generally print Private Use Area code points and rely on the configured terminal font. They do not transmit font outlines.

Ghostty's custom glyph protocol can register outlines, but the tested wterm packages did not expose the Ghostty glyph glossary or render those outlines in the DOM layer. Adding this would require changes to the Ghostty WASM interface, terminal core API, and DOM renderer. It would still not provide general Ghostty font parity.

Exact Ghostty presentation would require the full native Ghostty renderer, not only its VT parser.

### Renderer completion was not observable

A terminal model watermark proved that bytes reached the model. It did not prove that the renderer presented the corresponding pixels. This weakened throughput measurements, screenshot timing, and sequence-recovery checks.

Any future renderer interface should expose a renderer-visible watermark or completion acknowledgement.

### WASM ownership was incomplete

`WTerm.destroy()` removed DOM nodes and listeners, but the public packages did not expose deterministic release for every Ghostty terminal and transfer-buffer allocation. Repeated terminal creation could therefore retain WASM memory.

A renderer cannot be considered production-ready without deterministic teardown and a test that repeatedly creates and destroys sessions while measuring native and WASM memory.

### Agent and plugin terminals had diverged

Agent terminals consumed Ghostty snapshots and sequenced live output. Regular Terminal plugin shells initially replayed a legacy PTY byte buffer. Feeding that replay into another terminal parser duplicated terminal query responses and corrupted prompts.

Changing the plugin path to use the same snapshot and sequence boundary fixed the behavior. The incident exposed a broader architecture problem: agent and plugin terminals should not implement separate session, replay, and capability policies.

### Resource loading was too implicit

The plugin path initially omitted the wterm stylesheet. Wterm initialization also wrote a fixed height onto its host element, which broke layout after navigation and reattachment.

Renderer setup should explicitly prepare styles, fonts, binary assets, and optional acceleration before creating a terminal view. Import side effects are not a reliable resource contract.

## Architecture worth keeping with xterm

These changes would improve the current xterm implementation without continuing a renderer migration.

1. Use one host-owned terminal session service for agent terminals and regular Terminal plugin shells. It should own session identity, PTY-instance identity, replay boundaries, attachments, input, resize, recovery, and stale-instance rejection.
2. Name exactly one terminal-state owner and one PTY protocol-response owner for each session. Diagnostic or shadow models may observe bytes, but they must not emit competing replies.
3. Keep Shell Session Key and PTY-instance checks on output, snapshots, recovery, and delayed callbacks. A replacement PTY must reject work from its predecessor.
4. Add renderer-visible completion to the terminal view contract. Xterm benchmarks and recovery tests need this too.
5. Build an xterm conformance suite for Unicode width, graphemes, ANSI styles, hyperlinks, selection, alternate-screen applications, resize and reflow, reconnect, input methods, and regular plugin shells.
6. Prepare renderer resources explicitly before session creation. This includes xterm CSS, fonts, addons, and WebGL fallback.

## Requirements for a future native Ghostty investigation

A future investigation should target full `libghostty`, not another browser renderer around `libghostty-vt`. It must decide where the canonical terminal state lives and avoid parsing each PTY stream in both the sidecar and renderer.

The current DOM-oriented `mount(HTMLElement)` contract will not be enough. A native attachment needs logical surface identity, viewport coordinates, device-pixel ratio, visibility, focus, input method handling, suspend and resume, reparenting, and deterministic disposal.

The investigation must also cover native view hosting in Electron, Metal or platform renderer ownership, crash isolation, multiple terminals, font fallback, accessibility, clipboard and links, image protocols, offline packaging, signing, CPU and GPU use, native memory, and teardown.

No production renderer work should start until a small native prototype proves that these constraints are workable.
