# Plugin-scoped browser sessions

Status: Accepted
Task: KVG-1788
Supersedes the session-scoping decision in ADR 0009

ADR 0009 gave each **Trusted Plugin** a separate browser session per **Task**, deriving the Electron partition from `sha256(pluginId ∥ taskId)`. In practice this meant re-authenticating to GitHub and every other site in every new Task, which is the dominant cost of using the Task Browser at all. OpenForge will instead derive the partition from the plugin alone, so one **Plugin Browser Session** spans every Task and project; a login performed in one Task is available in all of them. Surfaces remain per-Task and per-window, and each surface's last committed URL stays in task-scoped plugin storage, so browsing position is still per-Task even though identity is not.

## Considered options

- **Per-project sessions** (partition keyed by plugin and project) were rejected because the re-login cost recurs at every project boundary while adding a scope the user must reason about, and OpenForge is a single-developer tool where cross-project cookie isolation buys little.
- **Coexisting per-Task and shared sessions** were rejected because a mode switch reintroduces the question the change exists to eliminate — "am I logged in here?" becomes conditional on invisible per-Task state — and it doubles the reset and purge surface.
- **Per-origin opt-in sharing** was rejected because Electron's isolation unit is the partition; sharing one origin across partitions requires hand-rolled cookie replication with a token-refresh race and no way to carry `localStorage` or IndexedDB.
- **Promoting an existing per-Task partition** to become the shared session was rejected because the choice among candidates is arbitrary and invisible, and Electron offers no partition-copy API: cookie-level migration silently drops `localStorage` and IndexedDB, yielding a half-migrated login that appears authenticated until it fails.

## Consequences

Isolation between Tasks drops to the threat model of an ordinary browser profile: same-origin policy still prevents one page reading another's cookies, but a malicious page loaded in any Task shares a cookie jar with every live login, so session-riding is possible from anywhere. This gives up a bonus property rather than a baseline one.

Task deletion no longer purges browser data, so the Rust sidecar stops recording browser-session purge intents in its Task-deletion transaction. Plugin uninstall remains a purge trigger, so the durable outbox, partition registry, and purge coordinator are all retained; intents recorded before this change still name the partition they were written for and drain correctly. On first launch after the change, OpenForge clears every legacy per-Task partition in the registry — costing one re-login — because those directories are otherwise unreachable credential stores that no surface can bind to and no reset can clear.

`resetSession` loses its `taskId` parameter. Blast radius is plugin-wide, and a parameter that reads as a scope but is ignored would invite callers to assume isolation that no longer exists. User-facing wording should reflect this ("Sign out of all sites"), not a per-Task reset.
