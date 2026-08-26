# Terminal state and protocol-response paths

OpenForge has one production terminal mode: xterm owns parsed terminal state and terminal-generated query responses. The Rust sidecar owns PTY processes, raw byte replay, and instance validation. The optional Ghostty model is diagnostic only.

The authority contract exists in two typed forms:

- TypeScript: `XTERM_AUTHORITATIVE_TERMINAL_CONTRACT` in `packages/terminal-runtime/src/terminalAuthority.ts`
- Rust: `TerminalAuthorityContract::xterm_authoritative()` in `src-tauri/src/pty_manager/authority.rs`

Both contracts name xterm as the parsed-state owner and query-response owner. They name the PTY byte buffer as replay owner and declare that no component owns a terminal snapshot path. The diagnostic model may observe PTY bytes. It may not send query responses or provide replay.

## Transport seam

Terminal Runtime receives terminal traffic only through `TerminalTransport`. The interface uses Shell Session Keys and camelCase domain events. It provides one session subscription for output and exit, one connection-restored subscription, replay reads, separate user-input and query-response writes, resize, and disposal.

The desktop adapter translates preload and Electron IPC event names, Rust-shaped payloads, and PTY commands. The Trusted Plugin adapter translates `openforge.*` global events, indexed Shell Session Keys, and frontend shell capabilities. Terminal Runtime does not know those event names, capability calls, credentials, or connection details.

Each Terminal Runtime owns its adapter. The core Agent Terminal and built-in Terminal plugin still use separate Terminal Runtime instances and separate session maps. An adapter may multiplex many Shell Session Keys. A restored connection is only a signal; Terminal Runtime selects active sessions and requests their replay.

## Session identity

Every live authority binding contains:

- one Shell Session Key
- one PTY instance ID
- the selected authority contract

A Shell Session Key identifies the concrete agent terminal or indexed shell session. The PTY instance ID identifies its current process generation. Reusing a Shell Session Key after replacement does not reuse the old authority binding.

`get_pty_buffer` returns `buffer`, `isLive`, and `instanceId`. Terminal Runtime binds replay and subsequent output to that instance. Live output with another instance ID is discarded.

## Agent terminal path

```text
agent PTY read
  -> Rust raw-byte reader
  -> optional diagnostic Ghostty feed
  -> Rust UTF-8 event batching and raw replay buffer
  -> pty-output-<Shell Session Key> with PTY instance ID
  -> desktop TerminalTransport adapter
  -> normalized output event
  -> desktop Terminal Runtime
  -> xterm parser and renderer
```

On initial acquisition or app-event reconnect, Terminal Runtime requests the PTY byte replay. xterm parses that replay before later live bytes. If the PTY is replaced while the replay request is pending, Terminal Runtime discards the completed replay because its requested instance no longer matches.

An ended agent terminal may use persisted raw replay when no live PTY buffer remains. That replay has no live instance and cannot produce a response accepted by the PTY boundary.

## Terminal plugin shell path

```text
plugin shell PTY read
  -> Rust raw-byte reader
  -> optional diagnostic Ghostty feed
  -> Rust UTF-8 event batching and raw replay buffer
  -> openforge.pty-output-<Shell Session Key>
  -> Trusted Plugin TerminalTransport adapter
  -> normalized output event
  -> Terminal plugin Terminal Runtime
  -> xterm parser and renderer
```

The built-in Terminal plugin uses the same Terminal Runtime package and the same xterm authority contract as agent terminals. Its `ShellAPI.getBuffer` result includes the PTY instance ID. The plugin does not select authority from renderer type, API presence, or the Ghostty diagnostic setting.

## Parser and partial escape sequences

xterm is the only production parser. Terminal Runtime sends each replay or live output write to xterm with the matching PTY instance ID. The xterm adapter keeps that ID while xterm parses the write. This includes escape sequences split across multiple writes.

A diagnostic model receives the original PTY bytes independently. Its parse success or failure does not change xterm state, replay selection, or response routing.

## Generated terminal responses

xterm's `onData` channel contains keyboard input and terminal-generated responses. The xterm adapter classifies known query-response forms and sends them through separate typed callbacks:

```text
PTY query bytes
  -> xterm parser
  -> xterm-generated response with source PTY instance ID
  -> Terminal Runtime authority check
  -> TerminalTransport.writeQueryResponse
  -> desktop or Trusted Plugin adapter
  -> pty_write_terminal_query_response IPC or shell capability
  -> Rust current-instance check
  -> ordered PTY writer
```

Keyboard input continues through `writePty`. Query responses never use that unscoped path. Rust rejects a response if its Shell Session Key is absent or its PTY instance ID is not current. A late response from a replaced xterm generation cannot reach the successor PTY.

The Ghostty diagnostic worker drains generated responses into a bounded diagnostic-only buffer. It has no PTY writer, desktop event sink, replay route, or public snapshot route.

## Replay and snapshot rules

- The Rust PTY byte buffer is the only replay authority.
- xterm's in-memory parsed state remains authoritative while its Terminal Runtime entry lives.
- OpenForge exposes no desktop terminal-view snapshot command in this mode.
- Ghostty native and portable snapshots remain internal diagnostic and test artifacts. Terminal Runtime cannot request or apply them.
- Reconnect replay captures the expected PTY instance before I/O and discards the result after replacement.
- Raw output events, exits, and query responses all carry or verify the PTY instance.

## Attachments

A Terminal View Attachment mounts the one xterm view owned by its Terminal Runtime entry. Concurrent acquisition of the same Shell Session Key resolves to the same entry and one query-response subscription. Moving or detaching the view does not create another parser or response authority.

Companion attachments consume the Rust PTY byte stream and use the current PTY instance. They do not parse queries for response generation and cannot become terminal replay authority.
