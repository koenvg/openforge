# Terminal state and protocol-response paths

OpenForge uses Ghostty as the terminal state authority for every live Terminal Session. The Rust Sidecar's `libghostty-vt` model owns parsed state, restoration snapshots, and terminal-generated replies. xterm remains the renderer and user-input surface.

Terminal authority is not configurable.

## Transport seam

Terminal Runtime receives terminal traffic only through `TerminalTransport`. The interface uses Shell Session Keys and camelCase domain events. Its session subscription carries sequenced Ghostty model output, model-disable signals, and exits. It also provides connection-restored subscriptions, restoration reads, user-input writes, resize, and disposal.

The desktop adapter translates preload and Electron IPC event names, Rust-shaped payloads, and PTY commands. The Trusted Plugin adapter translates `openforge.*` global events, indexed Shell Session Keys, and frontend shell capabilities. Terminal Runtime does not know those event names, capability calls, credentials, or connection details.

One host-owned Terminal Runtime owns the desktop adapter and shared session map used by the core Agent Terminal and built-in Terminal plugin. The adapter may multiplex many Shell Session Keys. A restored connection is only a signal; Terminal Runtime selects active sessions and requests their restoration state.

## Session identity

Every live Terminal Session is identified by one Shell Session Key and one PTY instance ID. Reusing a Shell Session Key after replacement does not reuse the previous Terminal Session.

Output, snapshots, replies, resize operations, and exits remain scoped to the PTY instance. Late data from a replaced instance cannot mutate or write to its successor.

## Live output path

```text
PTY read
  -> libghostty-vt actor
     -> canonical parsed terminal state
     -> sequenced output frame
     -> terminal-generated protocol reply
  -> pty-model-output-<Shell Session Key>
  -> desktop or Trusted Plugin TerminalTransport adapter
  -> normalized model-output event
  -> Terminal Runtime instance and sequence checks
  -> xterm renderer
```

The bytes rendered live by xterm are the same PTY bytes, but they are published only after Ghostty has accepted them. xterm therefore remains the renderer without becoming the backend state authority.

The built-in Terminal plugin requests view attachments from the same host-owned Terminal Runtime as agent terminals. The host transport reads restoration state, subscribes to normalized output, and routes input and resize operations. The plugin does not select terminal authority, renderer type, or lower-level transport capabilities.

Ghostty's `on_pty_write` replies go directly through the Shell Session Key and PTY-instance-scoped ordered writer. xterm discards any responses it generates while rendering the Ghostty-owned state, so a query has one response owner.

## Terminal colour profile

The selected application theme is the policy owner for terminal defaults. After the theme's tokens and optional plugin stylesheets are active, the renderer resolves the canvas, terminal foreground, background, cursor, and 16 ANSI colours through the browser's CSS engine. Transparent values are composited to opaque sRGB and normalized to a versioned RGB profile. The entire profile must resolve; otherwise selection falls back to OpenForge Light instead of publishing a partial palette.

Theme commit ordering is deliberate:

```text
activate theme CSS and tokens
  -> resolve one complete opaque RGB profile
  -> persist it as the installation commit point
  -> update every healthy live Ghostty authority
  -> publish the matching Terminal Runtime presentation and selected theme
```

The Sidecar stores the last accepted profile in the installation daemon root. Once that durable write succeeds, later fanout failure cannot reject the selection and send the UI back to an older theme. Every healthy model still receives the update; a model that rejects it disables itself, and a disconnected Session Daemon receives the committed profile during reconciliation before a later spawn. The same commit updates the isolated legacy PTY manager path. Ghostty installs the profile before accepting child output. A live update is one ordered actor command per model; it changes defaults while retaining application OSC colour overrides. An OSC reset exposes the latest selected default.

Terminal Runtime derives xterm's background, foreground, cursor, and core ANSI values from that same normalized profile. Changing the base xterm theme would otherwise clear xterm's local OSC overrides, so an attached view immediately recovers the Ghostty snapshot after the update. The Shell Session Key, PTY instance, Terminal Session, and attachment stay unchanged. A detached view is marked for the same recovery on its next attachment.

## Snapshot and reconnect

`get_pty_buffer` returns a portable VT snapshot for a live Terminal Session containing:

- the PTY instance ID
- the Ghostty actor's output watermark
- base64-encoded VT restoration bytes formatted by `libghostty-vt`
- base64-encoded compatibility replay, capped at 256 KiB of the newest model-accepted bytes and captured by the same actor command and watermark
- base64-encoded parser continuation, captured with the same watermark; empty continuation means parser ground

Terminal Runtime registers transport listeners before requesting restoration. It applies bounded compatibility replay so xterm can reconstruct renderer-owned state such as inline images. A byte-oriented CAN then cancels unfinished replay parser/UTF-8 input before portable VT restores canonical presentation. The captured parser continuation is applied last, so subsequent live bytes can complete split escape sequences or UTF-8 characters. All three payloads belong to one actor-captured PTY instance and watermark. Terminal Runtime discards frames at or below that watermark and applies contiguous later frames. A sequence gap requests a fresh Ghostty snapshot rather than using OpenForge's raw PTY replay buffer as canonical state.

Ghostty checkpoints retain the selected profile, all 256 effective palette entries, and application overrides. Portable VT recovery therefore restores the same query answers and presentation. Checkpoints written before the profile field existed use OpenForge Light.

Completed Agent Sessions may still display persisted raw replay after their live Terminal Session has ended. That replay is historical presentation data and cannot generate a reply accepted by a PTY.

## Failure behavior

A Terminal Session does not fall back to xterm-owned state when its Ghostty model disables. The Rust Sidecar terminates the affected PTY instance instead of mixing response or restoration owners.
