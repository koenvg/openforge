# Terminal state and protocol-response paths

OpenForge supports two explicit terminal authority modes. Both render through xterm and retain the same keyboard, IME, selection, link, image, accessibility, and presentation paths.

- `xterm-authoritative`: xterm owns parsed state and terminal-generated replies; the Rust PTY byte buffer supplies replay.
- `ghostty-authoritative`: the Rust sidecar's `libghostty-vt` model owns parsed state, restoration snapshots, and terminal-generated replies; xterm renders the model's portable VT snapshot and later output bytes.

The experimental `ghostty_terminal_state_enabled` setting selects the authority for newly created Terminal Sessions. Existing sessions retain the contract captured at spawn.

The contracts are typed in both runtimes:

- TypeScript: `XTERM_AUTHORITATIVE_TERMINAL_CONTRACT` and `GHOSTTY_AUTHORITATIVE_TERMINAL_CONTRACT` in `packages/terminal-runtime/src/terminalAuthority.ts`
- Rust: `TerminalAuthorityContract::{xterm_authoritative, ghostty_authoritative}` in `src-tauri/src/pty_manager/authority.rs`

## Transport seam

Terminal Runtime receives terminal traffic only through `TerminalTransport`. The interface uses Shell Session Keys and camelCase domain events. Its session subscription carries raw PTY output, sequenced Ghostty model output, model-disable signals, and exits. It also provides connection-restored subscriptions, restoration reads, separate user-input and query-response writes, resize, and disposal.

The desktop adapter translates preload and Electron IPC event names, Rust-shaped payloads, and PTY commands. The Trusted Plugin adapter translates `openforge.*` global events, indexed Shell Session Keys, and frontend shell capabilities. Terminal Runtime does not know those event names, capability calls, credentials, or connection details.

One host-owned Terminal Runtime owns the desktop adapter and shared session map used by the core Agent Terminal and built-in Terminal plugin. The adapter may multiplex many Shell Session Keys. A restored connection is only a signal; Terminal Runtime selects active sessions and requests their restoration state.

## Session identity

Every live authority binding contains one Shell Session Key, one PTY instance ID, and one authority contract. Reusing a Shell Session Key after replacement does not reuse the previous binding.

Output, snapshots, replies, resize operations, and exits remain scoped to the PTY instance. Late data from a replaced instance cannot mutate or write to its successor.

## xterm-authoritative path

```text
PTY read
  -> Rust UTF-8 event batching and bounded raw replay buffer
  -> pty-output-<Shell Session Key> with PTY instance ID
  -> desktop or Trusted Plugin TerminalTransport adapter
  -> normalized output event
  -> Terminal Runtime instance check
  -> xterm parser and renderer
```

Initial acquisition and reconnect request `get_pty_buffer`. Terminal Runtime replays the retained bytes and then applies live output for the same PTY instance.

xterm-generated query responses are separated from user input and sent through `TerminalTransport.writeQueryResponse`. The desktop or Trusted Plugin adapter invokes `pty_write_terminal_query_response`; Rust checks the Shell Session Key, PTY instance, and authority contract before the ordered PTY writer accepts the response.

## Ghostty-authoritative path

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

Ghostty's `on_pty_write` replies go directly through the Shell Session Key and PTY-instance-scoped ordered writer. Terminal Runtime drops xterm-generated replies in this mode, so a query has one response owner.

## Snapshot and reconnect

`get_pty_buffer` returns a discriminated authority mode. A Ghostty-authoritative live session returns a portable VT snapshot containing:

- the PTY instance ID
- the Ghostty actor's output watermark
- base64-encoded VT restoration bytes formatted by `libghostty-vt`
- base64-encoded compatibility replay, capped at 256 KiB of the newest model-accepted bytes and captured by the same actor command and watermark

Terminal Runtime registers transport listeners before requesting restoration. It applies the bounded compatibility replay first so xterm can reconstruct renderer-owned state such as inline images, then applies portable VT as the canonical parsed state. Both payloads are actor-captured for one PTY instance and watermark. Terminal Runtime discards frames at or below that watermark and applies contiguous later frames. A sequence gap requests a fresh Ghostty snapshot rather than using OpenForge's raw PTY replay buffer as canonical state.

Completed Agent Sessions may still display persisted raw replay after their live Terminal Session has ended. That replay is historical presentation data and cannot generate a reply accepted by a PTY.

## Failure behavior

The modes never mix response or restoration owners. A Ghostty-authoritative session does not silently fall back to xterm authority when its model disables; the view stops accepting interaction for that PTY instance. A dedicated follow-up covers terminating or explicitly recovering the affected Terminal Session.
