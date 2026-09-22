## Context

See `proposal.md` for motivation and `specs/pr-review-agent-session/spec.md` for the changed behavior.

The pull request review flow currently couples session creation to the first walkthrough prompt. `AgentTab.svelte` then wraps the host terminal mount with its own status header, Stop action, retry states, and textarea. The Task Agent view instead gives the shared Terminal Runtime one bordered, padded terminal container and lets the provider own interaction inside it.

Scoped Agent Sessions already accept an empty initial input. The Claude command builder omits an empty prompt, which starts the interactive provider in the scoped checkout. Later `agentSessions.input()` calls can paste a prompt into a live PTY or resume a stopped provider conversation. The current walkthrough coordinator refuses a live session, however, and it treats PTY exit as the end of a generation turn. An always-running interactive TTY therefore needs provider-turn lifecycle signals that do not depend on process exit.

The screenshot also shows `An object could not be cloned.` from the terminal mount. Session Scope values flow out of Svelte rune state and eventually cross Electron IPC. DOM elements and renderer disposables must never enter that boundary, and proxied scope objects must become plain data before IPC serialization.

## Goals / Non-Goals

**Goals:**

- Keep one interactive scoped PTY alive for the selected pull request head and attach it when the Agent tab is active.
- Separate agent startup from walkthrough generation without losing attempt completion, retry, or failure tracking.
- Keep DOM attachment ownership in the renderer and preserve the existing generation and PTY identity fences.
- Match the Task Agent terminal's container, focus, fitting, input, and retained-output behavior.

**Non-Goals:**

- Change the review-read-only tool permissions, walkthrough step format, Review Thread behavior, or pull request scope identity.
- Add another general-purpose terminal API to the Plugin SDK.
- Preserve scoped sessions across application restart or plugin deactivation.
- Add a replacement Stop control elsewhere in the pull request page.

## Decisions

### 1. Start the session on Agent-tab activation, not pull request selection

The pull request session controller will expose an idempotent activation operation. `PrReviewDetailSection` will call it when `activeTab` becomes `agent`. After Project resolution and revision cleanup, it will start a missing Scoped Agent Session with an empty initial input and `review-read-only` policy. An existing session for the same scope will only be reattached.

The controller will keep one pending start per exact Session Scope. Tab rerenders, repeated activation, and availability invalidations will join that promise rather than launch duplicates. Switching the pull request head keeps the existing abort-and-release rotation before a new scope may start.

Starting during pull request selection was rejected because merely reading Overview or Files changed would consume a scoped execution slot and create a checkout. Starting on Generate was rejected because the terminal would remain an empty form until the user clicked the action, which is the behavior this change removes.

### 2. Keep the Agent tab body terminal-only

`AgentTab.svelte` will become an attachment owner with one full-height terminal container. It will use the Task Agent terminal classes and theme variables for the bordered, rounded, padded TTY. The component will retain its logical-scope comparison, serialized replacement, stale-disposer protection, and `onDestroy` attachment cleanup.

The component will remove the status header, generation copy, Stop or retry controls, and follow-up form. Queue, startup, unavailable-Project, and mount errors will appear inside the terminal frame as passive terminal-style states. They will not add another panel above or below the TTY.

The Generate walkthrough action will move to the existing pull request detail header and appear while Agent is active. It will be disabled when Project resolution failed, the session cannot accept input, or an attempt is already generating. No Stop action will replace the removed one. A reviewer who needs to interrupt the process uses the interactive terminal.

Keeping a compact status bar inside Agent was rejected because the requested reference is the Task Agent view, where the provider terminal is the interaction model. Keeping the textarea was rejected because it creates a second input channel with different focus and keyboard behavior.

### 3. Generate starts a tracked turn in the existing interactive session

Walkthrough preparation will still create the immutable file snapshot and attempt record before sending a prompt. The coordinator will then call `agentSessions.input()` for a live or resumable session instead of rejecting `running` and `paused` states. It will never call `agentSessions.start()` as part of Generate after this change.

The returned state alone cannot identify completion because an interactive Claude PTY remains alive after a turn. The host-owned scoped Claude settings will therefore add lifecycle hooks alongside the existing final `PreToolUse` policy hook:

- `UserPromptSubmit` assigns an opaque turn id to the current scoped session and reports it as running.
- `Stop` marks that turn paused after Claude finishes responding while leaving the PTY and Scoped Workspace alive.
- `SessionEnd` keeps process exit as the terminal session outcome.

The hook endpoint will derive the scoped session, plugin owner, PTY instance, and policy identity from the host-issued scoped credential and environment. It will reject caller-supplied ownership and stale PTY instances. Accepted turn transitions will enter a durable, ordered journal. A backend observer establishes its journal cursor before sending Generate input, then replays every transition between polls. Generate appends a strict end-of-prompt marker containing its opaque attempt id. The host-owned `UserPromptSubmit` hook uses that marker as the turn id; ordinary TTY prompts without the marker receive a random id. The coordinator binds only to its marked turn and treats that turn's `Stop` transition as normal attempt completion. Generate remains unavailable while another turn is running. A later terminal follow-up cannot hide or finish an older attempt.

An agent-invoked `finish-walkthrough` command was rejected. Forgetting that command would leave Generate disabled indefinitely, and the host already has a reliable provider Stop hook for the end of every turn. Exiting and respawning Claude for each Generate action was rejected because it would no longer be the live TTY the user asked for.

### 4. Normalize scope data before IPC and keep DOM objects renderer-local

The frontend Agent Sessions boundary will copy `namespace`, `targetKey`, and `revision` into a plain `SessionScope` before any typed IPC call. No Svelte proxy, `HTMLElement`, Terminal Session handle, attachment, or disposable may enter Electron IPC.

`mountTerminal(scope, element)` remains frontend-only. It will hash the normalized scope and use the owner-scoped Terminal Runtime client in the renderer. Only normal typed scope and status requests cross IPC. The returned disposable remains in the renderer and detaches only the current attachment generation.

Tests that mock `mountTerminal` alone did not catch the reported structured-clone failure. The integration coverage will invoke the real frontend API and terminal host path with a rune-derived scope, then prove that IPC receives plain scope data while the DOM element stays local.

Moving the terminal into the plugin bundle was rejected because it would expose PTY identity and duplicate replay, stale-instance filtering, resize leases, and teardown. Sending the element through IPC was rejected because DOM nodes are not structured-cloneable.

### 5. Keep terminal outcomes and retry state without a Stop button

An unsuccessful provider exit or session failure finishes the active attempt as failed, while a host-aborted Scoped Agent Session finishes it as aborted. Keyboard input such as Ctrl-C remains provider-owned: if the provider reports the turn's normal Stop lifecycle event, that turn is complete; if the process exits unsuccessfully, the attempt fails. Accepted partial steps remain provisional unless the matching turn completes normally. Once an attempt reaches `ready`, `no-submissions`, `failed`, or `aborted`, Generate becomes available again when the session can accept input.

The terminal transcript is the diagnostic record. The Agent tab will not repeat those outcomes as prose around the TTY. Walkthrough presentation can continue to expose its own ready or failed state where that state is needed.

## Risks / Trade-offs

- [Opening Agent consumes a scoped execution slot before Generate] -> Start only on tab activation, reuse the exact scope, and keep the existing host queue limits visible inside the terminal frame.
- [A stale Stop hook completes the wrong walkthrough] -> Fence hook acceptance by scoped credential, PTY instance, opaque turn id, and active attempt identity.
- [Direct terminal typing races with Generate] -> Disable Generate while an attempt is active and bind completion to the turn created by the Generate-submitted prompt.
- [A proxied value reaches another IPC call] -> Normalize Session Scope once at the frontend API boundary and add a real bridge test that rejects non-plain payloads.
- [Removing the Stop button makes interruption less discoverable] -> Preserve normal terminal interruption and let the provider TTY show its own keyboard interaction; do not add duplicate chrome.
- [Terminal-style startup states are not a real PTY yet] -> Keep them within the terminal frame and replace them in place as soon as the attachment becomes available.

## Migration Plan

1. Add scoped turn lifecycle persistence, hook authorization, and change invalidations while keeping the current Agent UI.
2. Let the session controller start an empty interactive provider on Agent-tab activation and update Generate to submit a tracked turn into it.
3. Move Generate to the pull request header, reduce Agent to the terminal attachment, and remove Stop and the textarea.
4. Normalize scope objects at the frontend boundary and verify the production terminal mount no longer raises a clone error.
5. Remove obsolete UI props, controller methods, tests, and generation-stop wiring after the terminal-only path passes affected-system validation.

Rollback can restore the old UI and Generate-start behavior without migrating stored data. Scoped sessions, walkthrough records, Review Threads, and Session Scopes keep their current formats.
