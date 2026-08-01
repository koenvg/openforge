# Companion Agent Terminal — Design

Status: accepted.

## Problem Statement

The Mobile Companion can show that a Task needs attention and summarize its Agent state, but it cannot show or interact with the actual Agent terminal. A user away from the desktop therefore cannot inspect a running TUI, answer an interactive prompt, or type directly into the Agent Session.

The long-term product direction is a full **Companion Terminal** capable of attaching to Agent and ordinary shell sessions. This first milestone deliberately implements only the **Companion Agent Terminal**: a full interactive TTY emulator attached to an already-running Task Agent Session. It does not add Agent lifecycle controls or general shell access.

This capability changes the Companion's security posture. Terminal input is remote command execution as the desktop user, so the earlier read-only Companion v1 description is no longer accurate. Because the app is still pre-release and used on developer-controlled devices, this milestone favors a small protocol and implicit authority for paired devices. That authority must be revisited before broader distribution.

## Product Scope

- Task detail becomes a two-tab screen: **Details** and **Terminal**.
- **Details** is always the initial tab.
- **Terminal** is always visible. It shows **No active Agent terminal** when the Task has no running Agent Session.
- Task detail exposes `agentTerminalAvailable`; existing Agent invalidations refresh the field, while the WebSocket independently revalidates it to handle races.
- Selecting Terminal while an Agent Session is available attaches automatically. If a session becomes available while the empty Terminal tab is visible, attachment also begins automatically.
- The terminal is a full bidirectional TTY surface: it renders ANSI/TUI output, sends keyboard input, supports paste, and resizes the shared PTY.
- Claude Code, Codex, OpenCode, Pi, and every other provider backed by the shared PTY manager use the same provider-neutral path.
- Mobile cannot start, resume, abort, replace, or kill an Agent Session.

## Attachment Lifecycle

- A Companion Terminal Attachment resolves the Task's running Agent Session once and stays bound to that concrete process instance.
- It never silently follows the Task to a later replacement Agent Session.
- If the attached process exits while visible, the final in-memory emulator screen remains with an **Exited** indicator and input disabled until the user leaves the Task screen.
- Opening a Task after its Agent process has exited shows **No active Agent terminal**. Retained backend output from an exited process is not exposed.
- Switching from Terminal to Details for the same Task keeps the attachment alive and continues consuming output, but the hidden terminal cannot send input.
- Leaving the Task screen ends the attachment and disposes its mobile emulator state.
- Backgrounding or locking the phone immediately ends the attachment without affecting the desktop Agent Session. Returning to the foreground creates a fresh attachment only when the Terminal tab is visible again.
- A foreground network interruption disables input, clears the emulator, reconnects automatically through the existing endpoint failover, performs a fresh bounded replay, and resumes live output.
- Input is never buffered across a disconnect or reconnect.
- One paired device may hold one attachment at a time. A newer attachment from that device replaces its older one. Other paired devices and desktop surfaces may attach concurrently.

## Concurrent Terminal Semantics

The underlying PTY has one input stream and one canonical geometry. Desktop surfaces and Companion attachments may all interact without a controller lease:

- input from every surface is accepted in arrival order;
- the most recent resize from any surface determines the PTY's rows and columns; and
- attaching mobile, rotating the phone, or opening/closing its software keyboard may therefore resize a desktop-visible TUI.

This deliberately simple last-writer-wins behavior is acceptable during the current development stage.

## Gateway Contract

### Address and authorization

- Companion v1 evolves in place rather than introducing v2.
- A Task-scoped authenticated WebSocket route, conceptually `/companion/v1/tasks/{taskId}/agent-terminal`, addresses the current Agent terminal without exposing internal PTY keys or provider session identifiers.
- The WebSocket uses the same pinned TLS host identity, device bearer credential, endpoint selection, and revocation model as the existing Companion HTTP/SSE client.
- Every paired device implicitly has terminal authority. There is no scope system or per-device terminal toggle in this milestone.
- Pairing approval, gateway explanation, and paired-device copy must explicitly disclose interactive Agent-terminal access and must not call the credential read-only.
- Terminal access remains available while macOS is locked as long as OpenForge and its Companion Gateway continue running.
- Device revocation, gateway disablement, host reset, or authorization failure immediately closes affected terminal channels and clears mobile terminal content according to the existing Companion recovery state.

### WebSocket framing

- Each attachment uses one dedicated WebSocket; the existing SSE connection remains a coarse resource-invalidation stream.
- Binary server-to-client frames carry UTF-8 terminal output.
- Binary client-to-server frames carry UTF-8 terminal input.
- Malformed UTF-8 is a protocol error; data is never decoded lossily.
- JSON text frames carry typed control messages such as attach, resize, ready, exited, error, authorization revoked, and gateway closing.
- The checked-in HTTP OpenAPI contract continues to describe `agentTerminalAvailable`. A separate concise terminal-v1 Markdown contract and shared valid/invalid JSON fixtures define the WebSocket protocol and are decoded by Rust and Dart tests.

### Startup ordering

1. The client opens the authenticated Task-scoped WebSocket.
2. The client sends the first attach control message with positive `columns` and `rows`.
3. The gateway replaces that device's older attachment, if present.
4. The PTY attachment seam resolves the Task's running Agent instance and applies the mobile resize.
5. The seam atomically establishes live delivery and captures the existing bounded replay so output is neither missed nor duplicated at the replay/live boundary.
6. The server sends the replay as binary UTF-8 output.
7. The server sends ready with `initialState: "replay"`.
8. Only after ready may the client send binary input or resize controls.

The explicit initial-state discriminator reserves a later `snapshot` strategy. Milestone one uses the existing 256 KiB bounded raw-output replay and accepts that a long-running full-screen application may depend on state older than that buffer. Exact server-side emulator checkpoints are deferred.

### Flow control

- The terminal data plane does not use generic command dispatch or the global App Event Bus as its source of truth.
- If a phone cannot consume output within bounded queues, the gateway closes that attachment. It never blocks Agent PTY output, grows an unbounded queue, or silently drops bytes into a connected emulator.
- The phone then follows the normal fresh-attachment/replay recovery path.
- Terminal input, output, replay content, and bearer credentials are never logged. Diagnostics may include metadata such as Task/attachment identifiers, byte counts, timing, status, and safe close reasons.

## Backend Ownership

The Rust PTY manager provides a purpose-built attachment capability that atomically exposes:

- resolution of a Task's currently running Agent PTY;
- current instance identity for stale-event protection;
- bounded replay plus gap-free live output;
- terminal input;
- terminal resize; and
- process exit.

The capability cannot perform Agent lifecycle operations. The Companion Gateway adapts that capability to the authenticated WebSocket and owns neither PTY process lifecycle nor terminal state. Electron renderer state is not involved. The existing desktop terminal pool continues to own desktop UI lifecycle, while the Rust PTY manager remains authoritative for the process and stream.

## Mobile Terminal Surface

- Use xterm.dart 4.x behind an OpenForge-owned adapter so transport/controller code does not depend directly on widget details.
- UTF-8 encode xterm.dart output into binary input frames and incrementally decode binary output before writing it to the emulator.
- Use system light/dark mode for the whole Companion app and a corresponding light/dark ANSI terminal palette.
- Support portrait and landscape. Recompute and send PTY dimensions whenever the usable grid changes, including software-keyboard visibility changes.
- Use one fixed, readable mobile monospace size. No pinch zoom or terminal settings are included.
- Provide a compact accessory row containing `Esc`, one-shot `Ctrl`, `Tab`, and four arrow keys. Text, Enter, Backspace, selection, copy, and paste use normal system/xterm behavior.
- Paste immediately through xterm.dart's paste API so bracketed-paste mode is honored when requested.
- Touch is reserved for focus, scrolling, selection, and copy. Terminal mouse-reporting events are not sent.
- OSC 52 clipboard operations are ignored. Only explicit user copy/paste may modify or read the phone clipboard.
- URLs and OSC 8 links are selectable/copyable text only; no link activation is included.
- Connection, ready/reconnecting, unavailable, and exited states plus every accessory key receive VoiceOver/TalkBack labels. A separate accessible transcript mode is deferred.

## Inline Images

The mobile terminal does not render iTerm2 inline images. The Companion Gateway consumes supported iTerm2 image escape sequences per attachment and substitutes `[Image unavailable on mobile]` before replay or live output crosses the WebSocket. Desktop inline-image behavior remains unchanged, and multi-megabyte base64 image data is not sent to the phone. SIXEL and Kitty graphics remain unadvertised.

## Persistence and Privacy

- Terminal replay and emulator state remain in memory only for the current foreground Task screen.
- The phone does not persist terminal output, input, transcript, screen state, or scrollback in preferences, files, SQLite, analytics, or secure storage.
- Leaving the Task screen, losing authorization, or leaving the connected foreground lifecycle disposes terminal content as described above.
- The desktop adds no durable terminal transcript for this feature.

## Testing Decisions

- Rust tests cover Task-to-running-Agent resolution, the no-running-session case, attach-only capability boundaries, one-attachment-per-device replacement, concurrent-device behavior, last-resize-wins behavior, replay/live atomicity, exit identity filtering, slow-consumer closure, malformed frames, UTF-8 rejection, authorization, revocation, gateway shutdown, and image-sequence replacement.
- Shared protocol fixtures are decoded by Rust and Dart tests and include valid/invalid attach, resize, ready, exited, and safe error controls.
- Dart tests cover xterm adapter encoding, input gating until ready, no input buffering, lifecycle detach, automatic fresh reconnect, terminal availability transitions, exited state, hidden-tab output, system themes, accessory keys, ignored mouse/OSC 52 behavior, and terminal-content disposal.
- Widget tests cover Details as the initial tab, the always-visible Terminal tab, empty/running/reconnecting/exited states, automatic visible-tab attachment, labeled controls, and preservation while switching tabs for the same Task.
- Manual acceptance is required on physical iOS and Android devices over LAN and Tailscale. It includes interactive Agent TUIs for every supported provider, portrait/landscape and keyboard resizes, concurrent desktop/mobile typing and resizing, background/foreground recovery, transient endpoint failure, revocation, gateway disablement, host lock, high-volume output, paste, and final-screen exit behavior.

## Out of Scope

- Starting, resuming, aborting, replacing, or killing Agent Sessions from mobile.
- Ordinary shell tabs, shell creation, shell closing, a generic terminal catalog, or public terminal identifiers.
- Exact server-side terminal screen snapshots or checkpoints.
- Persistent terminal history or transcripts.
- Background terminal networking, push notifications, or queued input.
- Per-device terminal permissions, capability scopes, or per-attachment desktop approval.
- Inline-image rendering, terminal mouse reporting, OSC 52 clipboard control, clickable terminal links, an in-app browser, or an accessibility transcript mode.
- Font settings, pinch zoom, terminal theme settings, or desktop theme synchronization.

## Follow-on Direction

- Replace bounded replay with a canonical server-side screen snapshot when the correctness/complexity trade-off is justified.
- Expand from Companion Agent Terminal to the full Companion Terminal with ordinary Task shell sessions and an appropriate public terminal-resource model.
- Design safe Host-local URL activation so a phone can intentionally reach a development server listening on the desktop's loopback interface without confusing desktop localhost with phone localhost.
- Revisit pairing authority, capability scopes, locked-host behavior, and release threat modeling before distribution beyond developer-controlled devices.
