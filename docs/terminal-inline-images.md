# Terminal inline images

OpenForge's embedded xterm.js terminal supports Pi tool-result images through the iTerm2 inline-image protocol (IIP). The terminal runtime loads `@xterm/addon-image` and an OpenForge compatibility handler before a PTY is allowed to advertise image support.

## Protocol and formats

- OpenForge keeps `TERM_PROGRAM=vscode` for existing terminal behavior.
- When, and only when, the terminal's image addons initialize successfully, the PTY receives `ITERM_SESSION_ID=openforge`. Pi then selects its `iterm2` direct-data renderer.
- The image bytes travel in the terminal stream as base64. Rendering never depends on browser access to a local filesystem path.
- PNG, JPEG, and GIF are decoded by `@xterm/addon-image`. Animated GIFs render their supported static frame.
- WebP is decoded in the renderer and converted in memory to PNG before it is passed to the image addon.
- SIXEL and Kitty graphics are not advertised by OpenForge. The installed image addon is configured for IIP only.

Pi's `terminal.showImages` setting and `/show-images` command remain authoritative. If Pi image output is disabled, an addon cannot initialize, or no capable OpenForge terminal is attached at start time, Pi keeps its normal readable text placeholder.

## Resource and failure limits

The shared terminal runtime applies these bounds to every terminal instance:

| Limit | Value |
| --- | ---: |
| Decoded image payload | 6 MiB per image (about 8 MiB as base64 on the wire) |
| Decoded image pixels | fewer than 12,000,000 pixels per image |
| Retained RGBA image storage | 32 MiB FIFO cache per terminal |

The compatibility handler validates base64, declared byte size, image signatures, dimensions, and browser decoding before rendering. Invalid, unsupported, oversized, or failed WebP conversions are consumed safely and replaced with `[Image: invalid or unsupported inline image]`; raw OSC escape data is not printed.

Images are reset with terminal buffer replay/new-session clearing and are released when the owning xterm instance is disposed. Detach/reattach, resize, and visibility refresh reuse the same terminal-owned image storage rather than creating overlay resources.

## Mobile Companion behavior

The milestone-one Companion Agent Terminal does not render inline images. Before terminal output or bounded replay enters a Companion Terminal WebSocket, the Companion Gateway consumes each iTerm2 inline-image sequence and substitutes `[Image unavailable on mobile]`. This per-attachment transformation leaves the desktop terminal stream and its image rendering unchanged while preventing multi-megabyte base64 image payloads from crossing to the phone. SIXEL and Kitty graphics remain unadvertised and unsupported as described above.

## Developer configuration

Set `environment.enableImages` to `false` when constructing Terminal Runtime for a Terminal Surface that cannot or must not render images. Such runtimes do not load the image addon and `getTerminalImageProtocol(entry)` returns `null`; callers must omit PTY capability advertisement in that case.

PTY spawn boundaries use the optional camelCase field `terminalImageProtocol`. The only accepted value is `iterm2`. Backend and CLI starts that omit the field do not receive `ITERM_SESSION_ID`, preserving Pi's text fallback.
