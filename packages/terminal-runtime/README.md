# @openforge-app/terminal-runtime

Host-owned terminal lifecycle runtime for OpenForge agent and trusted-plugin Terminal Surfaces.

This package is MIT-licensed so plugin authors can build and redistribute Terminal Surface integrations against the public OpenForge host runtime contract. It must only compose public plugin capabilities. It must not import OpenForge renderer stores, Electron or preload internals, Rust Sidecar helpers, or other private app modules.

## Terminal transport

`createTerminalRuntime` accepts one options object containing a `TerminalTransport` and a `TerminalRuntimeEnvironment`:

```ts
const runtime = createTerminalRuntime({
  transport,
  environment: {
    openLink: (shellSessionKey, url) => openTerminalLink(shellSessionKey, url),
    themeMode,
    loggerName: 'myTerminalSurface',
  },
})
```

One Terminal Runtime owns one transport. The transport may multiplex many Shell Session Keys. It normalizes live output, PTY exit, connection restoration, and Terminal Replay into camelCase domain types. It also keeps user input separate from PTY-instance-scoped terminal query responses.

Terminal Runtime continues to own Terminal Session lifecycle, replay ordering, current PTY instance checks, Terminal View Attachments, and Terminal Geometry Leases. A transport restores connectivity but does not decide replay policy. `TerminalView` does not receive transport, IPC, capability, or connection details.

The interface is exported from the package root and `@openforge-app/terminal-runtime/terminalTransport`.

The desktop host creates one `TerminalSessionService` and gives each Terminal Surface an owner-scoped client. Clients share sessions by Shell Session Key, while bulk release affects only sessions owned by that client.

## Renderer conformance

`TerminalView` exposes semantic presentation capture and renderer-frame drain evidence for conformance tests and benchmarks. See [`conformance/README.md`](conformance/README.md) for the shared KVG-3903 recording corpus, interaction matrix, visual bounds, and memory metrics.
