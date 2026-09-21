# Recovering an incomplete restart

Electron keeps **Recover Incomplete Restart** available in the application menu even when the Sidecar or workspace cannot load. Recovery offers Retry attachment, Quit and stop sessions, or Keep waiting. Normal Quit from an incomplete restart also uses authenticated local cleanup. It does not need a healthy Sidecar.

The saved operation distinguishes failed preparation, failed activation, delayed relaunch, incomplete workspace restoration, and loss of the original session process. Only acknowledged workspace restoration commits the restart. Termination is recorded separately, not as a successful update.

Readiness deadlines limit waiting, not session lifetimes. Retry reuses the operation and attaches to the existing daemon before restoring windows. The launch guard passes to a delayed child so losing the launcher cannot permit a competing launch. Once ready, the daemon's lifetime lock protects ownership.

## Local recovery without Electron

Use the daemon executable from the current installation:

```sh
/path/to/openforge-session-daemon --terminate-sessions /path/to/installation/session-daemon
```

The root is the directory passed to the daemon at launch, not its `session-v1` subdirectory. Isolated fixtures must use their own root, never the developer app's root.

Electron additionally supplies the expected installation and original daemon lifetime. The same fenced form is available locally:

```sh
/path/to/openforge-session-daemon --recovery-status ROOT INSTALLATION LIFETIME
/path/to/openforge-session-daemon --terminate-sessions ROOT INSTALLATION LIFETIME
```

These commands use existing private credentials and verify the local socket peer's user identity. They acquire a fresh controller rather than reuse stale authority. The status command is for recovery after the failed Sidecar has stopped, not background polling of a healthy app.

Termination stops only verified PTYs from the authenticated inventory and shuts down the empty daemon. It never starts a host, opens the application database, or searches for processes by name. If the shutdown reply is lost, a retry can confirm absence only when both launch and daemon ownership locks are free. A different daemon lifetime is not authorized for termination by an old recovery record.

A nonzero exit means cleanup is not confirmed. Some sessions may already have stopped. Authentication failure requires access to the installation's existing credentials; do not delete or replace credentials to bypass it.

## Fallback is not database rollback

Compatible daemon executable fallback retains the sole PTY-owning process but still reports unsuccessful activation. Recovery never launches an older Sidecar against a database migrated by a newer Sidecar. Losing the PTY-owning process is cold process loss. Later provider-history recovery starts new processes and must not be presented as uninterrupted continuity.
