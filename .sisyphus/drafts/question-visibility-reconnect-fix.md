# Draft: Question Visibility + Reconnection Bug Fix

## Requirements (confirmed)
- User wants to see which sessions have pending agent questions
- There's a bug: input doesn't work when reconnecting to a session with a pending question
- User wants a dedicated test task alongside implementation tasks

## Research Findings

### What Already Exists
- **"Needs Input" badge** on TaskCard: shown when `session.status === 'paused' && checkpoint_data !== null`
- **CheckpointToast**: temporary notification that auto-dismisses after 8 seconds, says "Agent needs input on [TICKET]"
- **checkpoint_data**: nullable JSON string field on AgentSession, stores raw permission data from OpenCode

### Reconnection Bug (refined after user feedback + Metis review)
User confirmed: terminal IS there on reconnect, but question is gone.

**CRITICAL finding from Metis: checkpoint_data is NEVER persisted to DB.**
Every call to `db.update_agent_session()` passes `None` for checkpoint_data.
The data only lives in the in-memory Svelte store.
- Tab-switching within app: store has the data → banner can read it
- App restart: data is LOST → banner would be empty

**Additional load-path filters block paused sessions:**
- `loadSessions()` in App.svelte only loads completed/failed from DB
- `loadSessionHistory()` in AgentPanel exits early for non-completed/failed
- Both would need updating IF DB persistence is in-scope

### Key Files
- `src/components/AgentPanel.svelte` — PTY management + reconnection logic
- `src/components/TaskCard.svelte` — "Needs Input" badge display
- `src/components/CheckpointToast.svelte` — Temporary toast notification
- `src/App.svelte` — permission.updated / permission.replied event handling
- `src/lib/types.ts` — AgentSession interface, checkpoint_data field
- `src/lib/stores.ts` — activeSessions map, checkpointNotification store

### Test Infrastructure
- Vitest + @testing-library/svelte
- Colocated test files: `TaskCard.test.ts`, `CheckpointToast.test.ts`, `AgentPanel.test.ts`
- Tests exist for the "Needs Input" badge in TaskCard.test.ts (lines 76-127)

## Technical Decisions
- User wants MORE prominent Kanban indicator (not just small badge — pulsing border, color, etc.)
- Reconnection bug: terminal IS there, but the QUESTION is not visible after reconnect
- User confirmed: same bug with `opencode attach` — likely OpenCode doesn't replay permission prompts
- Implication: We need to store the question and display it from our own data (checkpoint_data), not rely on OpenCode re-sending it

## Approach
- **Kanban**: Enhance TaskCard with more prominent visual treatment for paused+checkpoint sessions
- **Reconnect question display**: Parse checkpoint_data and show the question in AgentPanel UI (above or below terminal) when session is paused
- **Workaround for OpenCode bug**: Since OpenCode attach doesn't replay questions, our app-side display becomes the primary way users see the question after reconnection

## Open Questions
- Should the question be shown as a banner/card in AgentPanel, or overlaid on the terminal?
- Do users need to reply to the question from our UI, or just see it (then respond via terminal)?

## Scope Boundaries
- INCLUDE: Prominent Kanban indicator, question display on reconnect, tests
- EXCLUDE: Fixing OpenCode itself, building a full question reply UI (unless user wants it)
