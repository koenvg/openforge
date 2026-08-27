# Add an opt-in Ghostty-authoritative terminal mode

Status: accepted

OpenForge adds a `ghostty-authoritative` contract behind the experimental terminal-state setting while keeping `xterm-authoritative` as the default. A Terminal Session captures its contract at creation: in Ghostty mode, `libghostty-vt` owns parsed state, restoration snapshots, output watermarks, and terminal-generated protocol replies; xterm remains the renderer and user-input surface. This avoids the previous mixed diagnostic mode while preserving the established rendering behavior.

## Consequences

Ghostty-authoritative sessions bootstrap xterm from Ghostty-formatted portable VT and then render sequenced bytes accepted by the model. xterm-generated replies are discarded and Ghostty replies use the existing Shell Session Key and PTY-instance-scoped ordered writer. Existing sessions never change authority when the setting changes, sequence gaps request a fresh Ghostty snapshot, and model failure cannot silently switch the session back to xterm authority.

Portable VT does not encode renderer-owned inline-image state. A Ghostty snapshot therefore includes a 256 KiB compatibility replay captured by the model actor at the same PTY instance and output watermark; when the limit is reached, it keeps the newest model-accepted bytes. Xterm applies that replay only to seed renderer compatibility state, then applies portable VT as the canonical parsed state. Later model frames still begin above the shared watermark; the Rust PTY replay buffer never becomes Ghostty's restoration authority.

OpenForge still owns PTY lifecycle, identity, attachment coordination, and transport ordering because those responsibilities cross the model and renderer boundary. The default xterm mode and historical replay for ended sessions remain unchanged.
