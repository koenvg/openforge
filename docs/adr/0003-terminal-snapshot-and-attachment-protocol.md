# Use capability-negotiated terminal snapshots

The Rust sidecar keeps Ghostty's native binary snapshot as the canonical terminal checkpoint. Each view attachment negotiates its bootstrap format: xterm receives portable VT restoration bytes, while a Ghostty view may receive the native snapshot once its web binding can decode it. Every bootstrap carries an OpenForge output watermark, and the view accepts only later live frames.

## Consequences

Attachments become interactive from the snapshot's renderable prefix before bounded history pages finish transferring. The active desktop attachment controls PTY dimensions; one companion may hold a revocable geometry lease only while no desktop attachment exists. The Rust sidecar is the sole authority for terminal-generated protocol replies, while views submit user input only.
