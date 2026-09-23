## Context

See `proposal.md` for the user-visible problem and `specs/task-attention-unread-output/spec.md` for the behavior. Desktop already has revision-scoped `mark_agent_output_viewed` persistence and derives Focus from the latest session's unread revision. Mobile has a two-tab Task screen and a terminal controller that presents bounded replay before `ready`; an exited attachment retains its last in-memory screen. Mobile's Board projection drops the unread flag, and Companion v1 exposes neither an acknowledgement mutation nor an output occurrence. The generated Dart client rejects unknown response fields. The terminal v1 parser also rejects unknown control fields.

## Goals / Non-Goals

**Goals:**
- Reuse the host's existing unread revision and Attention placement, without a second mobile read state.
- Keep current paired clients working against an upgraded desktop. A new client paired to an older desktop must leave output unread rather than guess which occurrence it saw.
- Never expose internal session or PTY IDs, terminal contents, or a persisted mobile transcript.

**Non-Goals:**
- Opening a stopped Agent's terminal history when no live attachment or retained mobile screen exists.
- Changing desktop acknowledgement behavior or giving mobile control of Agent lifecycle.

## Decisions

### Give mobile an occurrence receipt and bind it to the displayed terminal

Add a task-scoped, paired-device-only acknowledgement endpoint accepting an opaque receipt. The host generates the receipt from the Task ID, latest Agent Session ID, and stopped output revision using a domain-separated digest; it returns it only for an unread occurrence. The receipt is an equality token, not an authorization credential: the paired bearer, project visibility, Task ownership, and current session/revision are checked at the endpoint. Resolve and validate the latest session under the database lock before calling the existing revision-scoped write. Duplicate and stale receipts make no change. Do not return a session ID or let the client specify an arbitrary revision.

The terminal attachment reports an opaque session-binding value derived from the Agent Session whose stored PTY instance matches the attachment. Task detail returns that binding with its occurrence receipt. If the PTY cannot be matched, no boundary is issued and no acknowledgement is possible. The opted-in terminal channel sends a `presentation_boundary` control after `ready` only when the host has observed a stopped revision **before** capturing a nonempty replay and verified the current receipt and attached PTY still match; this control contains the exact receipt and binding. Mobile acknowledges only when that receipt matches the current Task-detail receipt, the Terminal tab is selected, and the app is foregrounded. When a newer stopped revision arrives on an already-ready socket, the old boundary cannot acknowledge it: mobile detaches and reacquires a fresh attachment/replay for the same Task without ending the desktop-owned terminal. On terminal exit, after all output frames, the Gateway sends a final-output `presentation_boundary` with the bound session binding immediately before `exited` only if this attachment has delivered nonempty replay or live output; an empty final screen is not evidence of presentation. The retained final screen can acknowledge a matching receipt when Task detail catches up. Discard bindings and boundaries on replacement, detachment, connection loss, or Task change. Never mark read on a `no_active_agent_terminal` screen.

A POST uses the existing pinned, authenticated Companion transport and makes one attempt, with no automatic endpoint failover or replay after an uncertain response. Refetch after a known success or uncertain result; only server-confirmed status drives the displayed unread marker. A fresh view may retry an occurrence still unread. Simpler Task-ID-only acknowledgement was rejected because it could clear a newer, unseen response; exposing internal session IDs was rejected by the Companion privacy contract.

### Add opt-in v1 response fields rather than break installed clients

Old Dart models reject unexpected fields. Add an explicit opt-in on Task detail and Board reads and on the terminal WebSocket upgrade. Without opt-in, the existing v1 JSON and controls remain byte-compatible. With opt-in, Board cards carry an optional `hasUnreadAgentOutput` boolean, Task detail carries an optional occurrence receipt plus session binding, and the terminal sends separate, ordered `presentation_boundary` controls after a post-revision replay or after final output. Update the OpenAPI schema, terminal protocol documentation, generated Dart client, and shared fixtures accordingly. Older desktops ignore opt-ins and return the old shape; the new mobile client treats absent fields as unsupported, keeps the card's existing display, and does not acknowledge. Do not silently infer unread from a Task state or reason.

The Board projection should carry `has_unread_agent_output` from the same Task Attention input used for placement, including Out of Focus, rather than recomputing it in Flutter. Keep optional response fields absent for callers that did not opt in. A separate per-card status request was rejected because it would add an extra fetch and risk mismatched Board snapshots.

### Keep visibility and refresh in the mobile lifecycle

Observe both the Task detail state and terminal presentation state in the Task screen or a small controller owned by it. Gate on selected tab, foreground state, current Task, matching terminal binding, and a displayed output occurrence. Coalesce pending requests per receipt; tear down on Task navigation or disposal. After a confirmed acknowledgement, refresh Task detail, Board lanes/counts, and Attention snapshot using the existing refresh controllers. The Board card shows a text-bearing "Unread agent output" label beside its workflow state and reason, and includes it in its accessibility label. Opening Details or merely constructing the Terminal widget does not send a mutation.

## Risks / Trade-offs

- A process may exit before a user sees its output. Preserve the binding and screen for an attachment that already presented output; a cold open without an attachment remains unread. Historical output access is a separate change.
- Task-detail invalidation and terminal frames arrive on different channels. The server must associate each boundary with its bound PTY and current stopped revision, send it only after the relevant replay or final output frames, and the client must compare the exact receipt. A prior `ready` cannot certify a newer revision. If replay is empty, becomes stale, or no presentation boundary can be established, leave unread status intact.
- An older desktop lacks the opt-in fields and POST route. The new client must treat this as unsupported rather than clearing local state or repeatedly attempting a mutation.
- A lost mutation response leaves the outcome uncertain. Do not automatically repeat it; refresh authoritative status, then retry only from a new confirmed unread view.

## Migration Plan

Ship the opt-in Gateway behavior first or alongside the new mobile build. Older mobile installs receive unchanged v1 responses and terminal controls. New installs paired to older hosts keep current display behavior without acknowledgement until the host upgrades. Rollback needs no data migration; the host's existing viewed revision remains valid for desktop clients.
