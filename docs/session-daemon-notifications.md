# Lifecycle notifications across backend replacement

KVG-4719 extends the [stable agent gateway](session-daemon-agent-gateway.md) with durable lifecycle delivery. On the controlled daemon-hosted path, completion and permission-waiting notifications can be accepted while the Sidecar is absent. They update the existing agent session when the replacement Sidecar registers.

This is not production restart or live daemon replacement enablement. The existing non-daemon launch path remains supported. Adoption of daemon ownership for every production provider, startup reconciliation, and executable replacement remain separate slices of preserve-sessions-across-updates.

## Acceptance and delivery

- `POST /notifications/agent-lifecycle` accepts only normalized lifecycle envelopes. It uses the allocation's agent capability, verifies the Task and PTY against that capability, and rejects shell capabilities and caller-supplied ownership headers. The ordinary command allowlist still excludes hook and private-delivery routes.
- Each sender generates an ID once and retains it across its bounded retry attempts. The journal assigns a global acceptance position. Duplicate IDs for the same allocation return the original receipt; reuse with different content fails.
- The daemon commits the envelope, full installation/lifetime/PTY identity, session key, sender ID, and acceptance position before returning HTTP 202. Its private `notifications.sqlite` file uses SQLite FULL synchronization and macOS fullfsync. The journal ID, records, and acknowledgement position survive reopening and Sidecar replacement.
- One worker delivers accepted positions in order to the authenticated private `/internal/agent-notifications` endpoint. It does not require the original sender to remain alive. It retries until the Sidecar returns the exact journal ID and committed position, then commits the acknowledgement locally.
- The Sidecar commits the session update and receipt cursor in one transaction. Repeated or older positions do not repeat domain writes or completion follow-ups. Gaps fail rather than advancing the cursor. New allocations cannot inherit notifications for a different PTY.
- A matching durable completion or permission-waiting notification can replace the specific interruption recorded by startup recovery, but not an explicit user stop. After a backend restart, normal session reads hydrate the committed presentation even if the old backend died before publishing an event.
- Claude's Stop notifications retain the existing background-work deferral behavior. Both hook paths decide eligibility against the matched session inside the domain transaction; a delayed Stop cannot revive an explicitly stopped session. A deferral's session/PTY identity and absolute deadlines commit with the receipt. Startup restores the existing watcher from these obligations, without extending their deadlines. Completion or a superseding lifecycle event clears the obligation transactionally. SessionEnd still completes the turn. Permission notifications mark the session paused; the transport neither decides nor approves permission requests.

## Provider behavior

Pi, Claude Code, Codex, OpenCode, and Grok use the same embedded notification client when `OPENFORGE_AGENT_CONFIG` is present. Existing processes keep their private launch-time route after replacement. Invalid explicit configuration fails closed, without falling back to a disposable or foreign listener.

A hook configuration file may reference only environment the launcher guarantees on every launch path, because a provider can refuse a hook that names a variable missing from the hook environment. Grok's and Claude Code's generated commands therefore always run the embedded client and pass their legacy endpoint as an argument, leaving the route choice to the client. Both redirect stdout to `/dev/null`, since both read `PreToolUse` stdout as a permission decision, and a generator test pins the whole shell-visible command per event for each. Grok's command adds a `$OPENFORGE_TASK_ID` guard and a trailing `; exit 0`, because its hooks are installed globally and it reads exit code 2 as a denial. Claude Code's adds neither: its configuration is passed per launch, and it reports a non-zero hook exit as a visible non-blocking error.

The generated adapters retain one ID for up to four attempts, with two-second request deadlines and 100/250/500 ms delays. Only transient failures and lost acceptance replies are retried. Rejected payloads, invalid configuration, and exhausted retries produce fixed, credential-free diagnostics. Long-lived adapters serialize their callbacks. Pi's settled turn reports completion and waiting for the next input; OpenCode permission and question events report permission/input waiting.

Legacy listeners do not have durable acceptance or deduplication. They keep their existing routes, and their requests are not replayed by the shared client. Where a legacy listener reads its provider's own hook body rather than the normalized envelope, as Claude Code's does for the activity snapshot and the background-work inventory, the client posts that body unchanged. The envelope limit below applies to the envelope, not to a provider body the hook process has already bounded when it read it. No request-response mutation or frontend plugin command enters this journal.

## Limits

| Resource | Limit |
| --- | --- |
| Incoming lifecycle envelope | 16 KiB |
| Provider hook stdin forwarded to a legacy listener | 64 KiB, past which it degrades to an empty body and the event still reports |
| Sender ID and Task ID | 128 ASCII identifier bytes each |
| Provider session ID and each raw diagnostic field | 256 bytes |
| Transcript path | 4 KiB |
| Activity snapshot and Claude background inventory | 8 KiB each, within the envelope limit |
| Retained journal records, including sender receipts | 4,096 |
| Retained serialized deliveries | 8 MiB |
| SQLite main-file page budget | 8,192 pages of 4 KiB, 32 MiB; a rollback journal can temporarily require additional bounded space |
| Pending callbacks per long-lived adapter | 64 |
| Private delivery response | 1 KiB |
| Sidecar receipt cursors | 256 journals |
| Sidecar deferred completion obligations | 4,096 sessions, 16 KiB serialized plan each (64 MiB total plan payload) |
| Delivery connection/response deadlines | 2 seconds / 5 seconds |

Acknowledged sender receipts remain until the allocation loses its capability, preventing delayed sender retries from becoming new events. The daemon then removes those receipts; unacknowledged deliveries remain. A long-lived allocation or outage can exhaust the budget. Full journals and storage failures return an observable failure, never a success followed by eviction of unacknowledged data. Worker diagnostics contain fixed text and report entry into a failed-delivery state rather than logging each retry.

## Verification

```sh
pnpm exec vitest run scripts/agent-notification-client.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/crates/session-daemon/Cargo.toml
node scripts/session-daemon-contract.mjs
```

The tests cover provider event mapping and exhausted retries, private authentication, invalid/capacity failures, journal reopen and receipt ordering, database migration failure/reopen, transactional rollback, duplicate event suppression, and real completion/permission notifications during a controlled Sidecar outage. Deferred-completion tests cover reopen before watcher scheduling, failed obligation writes, original deadlines, superseding permissions/stops/allocations, capacity, and a second real Sidecar replacement after Stop commits. The real-process fixture uses an isolated app-data directory and never launches or stops the installed desktop app.

Full affected-system validation also includes desktop tests, TypeScript, lint, Electron/Companion contracts, and test/check/build/clippy/formatting for the Backend Crate and session protocol, host, client, and daemon crates. These checks do not establish macOS x64 or live daemon reexec support.
