## Context

See `proposal.md` for motivation and the delta spec for the required behavior.

The pull request review workspace already owns one current-head `SessionScope`, subscribes to `ScopedAgentSessionState`, and mounts the terminal only while the Agent tab is selected. The state has a durable `turnId`, but `status: "running"` is also used by a connected session that has no active turn, so status alone is not a reliable activity signal. The terminal component knows when attachment succeeds, while tab selection lives in the parent workspace. Plugin storage is available without a backend or Agent Sessions contract change.

The shared Plugin SDK `Tabs` component currently supports a text label or a replacing icon, but no content after a text label. The signal therefore needs one small, generic Tabs extension rather than GitHub-specific behavior in the SDK.

## Goals / Non-Goals

**Goals:**

- Derive running state from the existing scoped-session lifecycle without treating an idle connected session as active.
- Keep unread state independent from running state and durable for the exact pull request head.
- Acknowledge output only after the current terminal can actually be seen.
- Make the tab signal usable with assistive technology and reduced-motion settings.
- Keep asynchronous scope changes and storage writes from leaking state between pull requests or turns.

**Non-Goals:**

- Adding a global inbox, application badge, notification, or unread count.
- Changing the public Agent Sessions API, terminal runtime, backend, or database schema.
- Tracking how many unseen turns or terminal lines exist; the UI exposes a binary unread state.
- Generalizing unread-output persistence to every plugin tab in this change.

## Decisions

### 1. Give review-agent attention state its own controller

Add a small review-workspace controller alongside `usePrReviewAgentSession`, rather than folding read receipts and window visibility into session ownership. It will consume the selected `SessionScope`, current session state, Agent-tab selection, terminal readiness, and browser visibility/focus. It will expose only `isRunning`, `hasUnreadOutput`, and the callbacks needed to report terminal readiness.

Running is derived as follows:

- `queued` and `starting` mean running work is pending.
- `running` means active work only when `turnId` is non-null.
- A `running` session with a null `turnId` is idle and does not show the running signal.
- Stopped statuses never show the running signal.

Unread is a separate state machine, so starting a follow-up turn does not erase an older unread result.

This separation keeps `usePrReviewAgentSession` focused on owning, rotating, and releasing host sessions. The alternative—putting all attention behavior into that controller—would couple session lifecycle to view focus and terminal rendering, making both the lifecycle tests and future consumers harder to reason about.

### 2. Persist a turn receipt per exact Session Scope

Store one versioned record in GitHub Sync's global plugin storage under a key derived from the full scope tuple (`namespace`, `targetKey`, and `revision`):

```ts
interface AgentAttentionReceiptV1 {
  version: 1
  viewedTurnId: string | null
  unreadTurnId: string | null
}
```

`unreadTurnId` keeps an older unread result intact while a newer turn runs. When another unseen turn stops, it replaces that value because the UI needs only a binary signal. `viewedTurnId` lets a restored stopped session distinguish an already-presented turn from output that still needs attention. A missing receipt plus a stopped session with a turn identity is handled conservatively as unread.

Use one storage key per scope rather than a shared map. This isolates writes between pull requests and removes read-modify-write contention. Storage reads and writes carry the observed scope and turn identity; a completion is applied to reactive state only if both are still current. Writes for one scope are serialized so a late acknowledgement cannot overwrite a newer unread turn.

The receipt is deleted when the owning scoped session is explicitly released because a pull request is removed or its head rotates. Ordinary navigation and controller disposal retain it.

The alternative of storing a single boolean cannot distinguish a new stopped turn after an earlier turn was read. Adding output revisions to the public Agent Sessions contract would solve a broader problem but is unnecessary because the existing turn identity provides the boundary this feature needs.

### 3. Define presentation as an explicit four-part gate

Output is considered presented only when all of these are true for the same current scope:

1. the Agent tab is selected;
2. the terminal attachment has completed successfully;
3. `document.visibilityState` is `visible`;
4. the application window has focus.

`AgentTab` will report readiness after the current scope's mount promise succeeds and report not-ready before detaching, on replacement or failure, and on destruction. It will keep its existing serialized reconciliation and `onDestroy` ownership; prop-keyed terminal resources will not be released from an effect cleanup.

The attention controller listens for document visibility and window focus changes. Whenever the gate becomes true, it acknowledges only the `unreadTurnId` captured for that scope. If a turn enters a stopped status while the gate is already true, that turn is recorded as viewed without briefly showing unread. If the tab is selected before the terminal is ready, acknowledgement waits for the readiness callback.

Using tab selection alone was rejected because selecting Agent can start an asynchronous mount, and clearing immediately would claim output was seen before it was renderable. Pointer or scroll tracking would be more precise in theory but adds complexity without useful distinction because the Agent terminal fills the active pane.

### 4. Extend Tabs with generic trailing content and an accessible label override

Add optional `trailing: Snippet` and `ariaLabel: string` fields to `TabOption`. Tabs renders trailing content after either the text label or icon without changing the trigger's selection and keyboard semantics. `ariaLabel` takes precedence; the existing icon-label behavior remains the fallback, preserving current callers.

The GitHub Sync Agent tab supplies a local activity-signal snippet and a computed accessible label such as `Agent, running`, `Agent, unread output`, or `Agent, running, unread output`. No live region is added: these are persistent navigation states, and announcing every lifecycle transition while focus is elsewhere would be disruptive. Assistive technology receives the state whenever it encounters the tab.

This is preferable to overloading the existing icon slot, which replaces the label and would make a domain-specific status convention part of a generic API.

### 5. Use distinct compact shapes and semantic tokens

Render active work as a small broken-ring spinner and unread output as a solid dot. The marker group reserves room for both signals, so simultaneous state is legible and status changes do not disturb tab interaction. The ring uses the running semantic color and the dot uses the informational semantic color, but their silhouettes differ so color is not the only cue.

Under `prefers-reduced-motion: reduce`, the ring stops rotating and remains a broken ring. The marker visuals are hidden from the accessibility tree because the trigger's computed accessible label carries their meaning.

## Risks / Trade-offs

- **[Coalesced session events can skip intermediate states]** → Reconcile from the latest durable `turnId` and stopped status; exact counts are deliberately out of scope.
- **[A storage operation can finish after the selected scope changes]** → Token every load and mutation with scope and turn identity, serialize per-scope writes, and ignore stale completions.
- **[Plugin storage can fail]** → Keep the conservative in-memory unread state, log the persistence failure, and never clear a signal merely because a write failed.
- **[Existing stopped sessions have no receipt after upgrade]** → Treat them as unread once; this avoids silently claiming old output was seen, at the cost of a one-time conservative signal.
- **[Shared Tabs API growth affects all consumers]** → Make both fields optional, retain current rendering and ARIA fallbacks, and cover text, icon, and trailing-content cases in the SDK component tests.
- **[Window focus is an approximation of human attention]** → Combine it with active tab, successful terminal attachment, and document visibility; avoid invasive pointer or gaze heuristics.

## Migration Plan

1. Ship the optional Tabs fields without changing existing callers.
2. Lazily read or create version-1 attention receipts as exact pull request scopes are observed; no database migration or bulk rewrite is required.
3. Treat a pre-existing stopped turn without a receipt as unread and create its receipt on first acknowledgement.
4. Delete receipts with their explicitly released PR review sessions so removed PRs and obsolete heads do not accumulate attention state.

Rollback is safe: older code ignores the namespaced plugin-storage records. Reapplying the feature can read the same version-1 records.
