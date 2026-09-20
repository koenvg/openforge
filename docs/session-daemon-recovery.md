# Local Session Daemon termination

The Session Daemon supports explicit local cleanup without a running Sidecar:

```sh
/path/to/openforge-session-daemon --terminate-sessions /path/to/installation/session-daemon
```

Use the daemon executable from the current installation. The argument is the same root passed to the daemon at launch, not its `session-v1` subdirectory. Isolated fixtures use their own root. Do not point a fixture at the developer app's root.

This command reconnects using the root's existing private credentials and the local socket peer's user identity. It acquires a new controller generation, terminates the verified live PTYs in that controller's inventory, waits for their exit, and shuts down the empty daemon. It does not start a daemon, open the application database, run provider-history recovery, or search for processes by name.

A nonzero exit means cleanup is not confirmed. Some sessions may already have stopped. Retrying authenticates again and reconciles the remaining inventory. A stale controller or invalid credential never permits PID-based cleanup. If authentication fails, restore access to the installation's existing credentials before retrying. Do not delete or replace the credential file to bypass the failure.

Daemon readiness deadlines limit the launcher's wait, not the daemon's lifetime. A delayed launch remains available for later attachment. While the launcher is alive, its launch lock prevents a second pending launch; an established daemon's lifetime lock prevents launching a competing owner when its socket is temporarily unavailable.

This is not Sidecar rollback. Do not run an older Sidecar against a database that a newer Sidecar has migrated. Losing the sole PTY-owning process is process loss, not uninterrupted session continuity.
