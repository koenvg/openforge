# Companion Agent Terminal WebSocket protocol v1

The authenticated Task-scoped endpoint is:

`wss://<paired-host>/companion/v1/tasks/{taskId}/agent-terminal`

Clients send the existing bearer credential and `openforge-companion-protocol-version: 1` header. The Task ID is public; provider session and PTY instance identifiers are never exposed.

## Frames

- Client control and server control use UTF-8 JSON text frames.
- Server terminal output uses binary frames containing valid UTF-8.
- Client terminal input uses binary frames containing valid UTF-8 and is accepted only after `ready`.
- Client messages and frames are limited to 4 KiB; controls are intentionally tiny.
- Unknown fields, unknown control types, malformed JSON, malformed UTF-8, non-positive dimensions, input before `ready`, and resize before `ready` are protocol errors.

## Startup

1. The client opens the WebSocket and sends `{"type":"attach","columns":80,"rows":24}`.
2. The server independently resolves the Task's currently running Agent PTY and applies the dimensions.
3. The server sends at most 256 KiB of bounded replay as binary UTF-8.
4. The server sends `{"type":"ready","initialState":"replay"}`.
5. After `ready`, the client may send UTF-8 terminal input as binary frames and later dimension changes as `{"type":"resize","columns":100,"rows":30}`. Gap-free live output continues as binary UTF-8.

The attachment remains bound to the concrete Agent process resolved at startup. It never follows the Task to a replacement Agent Session. The attachment capability can write and resize that PTY but cannot start, resume, abort, replace, or kill an Agent Session.

## Shared PTY semantics

Desktop terminal surfaces and all paired-device attachments write to the same PTY input stream in arrival order. There is no controller lease. The most recently applied resize from any desktop or mobile surface becomes the canonical PTY geometry.

## Terminal output sanitization

Raw Agent PTY bytes are processed by a Companion-only streaming sanitizer before entering bounded replay or live WebSocket fan-out. Desktop PTY events remain unchanged.

- Complete iTerm2 `OSC 1337;File=...` inline-image sequences, terminated by BEL or ST, become `\r\n[Image unavailable on mobile]\r\n`. Recognition and terminators may span arbitrary PTY reads.
- A single image sequence may consume at most 1 MiB. Oversized or unterminated images and malformed UTF-8 stop the attachment with a safe `protocol_error`; image bytes are neither replayed nor sent.
- Every output binary frame contains complete, valid UTF-8. Other ANSI and control sequences remain byte-for-byte intact.
- OSC 8 labels and plain HTTP(S) URLs remain selectable/copyable terminal text. The client installs no browser or external-link activation handler, and terminal mouse reporting remains disabled.

## Privacy

Terminal input, output, replay, source text, image payloads, and bearer credentials are ephemeral and must not be written to preferences, files, SQLite, analytics, secure storage, logs, or diagnostic errors. Diagnostics may include only non-content attachment metadata and byte counts.

## Server controls

- `ready`: replay is complete and live delivery is active.
- `exited`: the attached process exited; the client preserves its in-memory screen and disables interaction.
- `error`: a safe public error. `no_active_agent_terminal` means no running Agent PTY could be attached; `attachment_replaced` stops an older channel from reconnecting over the newer channel for that device.
- `authorization_revoked`: the paired-device credential was revoked.
- `gateway_closing`: the Companion Gateway is shutting down.

A slow client is closed instead of blocking PTY output or silently dropping connected output. Reconnection creates a fresh attachment and replay. Terminal content and credentials must not be logged or persisted.
