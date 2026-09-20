## 1. Scoped interactive turn lifecycle

- [x] 1.1 Add failing Rust service and database tests for an empty-input scoped launch followed by `UserPromptSubmit`, `Stop`, and `SessionEnd`; verify one PTY stays alive while matching turn ids move through running, paused, and terminal session outcomes.
- [x] 1.2 Implement scoped turn identity and lifecycle persistence without changing Session Scope or Task-owned session behavior; verify tests reject stale PTY instances, unknown scoped credentials, duplicate hook delivery, and a Stop event for another turn.
- [x] 1.3 Add host-owned scoped Claude lifecycle hooks alongside the final read-only `PreToolUse` hook; verify generated settings retain the deny policy, exclude user and Project settings, and report prompt, stop, and session-end events through authenticated host routes.
- [x] 1.4 Publish scoped-session invalidations for accepted turn transitions and expose the updated opaque `turnId`, status, and `acceptsInput` through existing typed boundaries; verify Rust, IPC, Plugin SDK fake, frontend host, backend host, and packaged-runtime contract tests agree.

## 2. Agent-tab session activation

- [x] 2.1 Add failing controller tests for Agent-tab activation starting one empty-input `review-read-only` session, repeated activation joining the same pending start, reopening reusing the same scope, and non-Agent tabs starting nothing.
- [x] 2.2 Implement an idempotent activation operation in the pull request session controller and invoke it only when the Agent tab becomes active; verify the focused controller and detail-section tests pass.
- [x] 2.3 Preserve Project resolution, queue state, and head-revision cleanup during automatic startup; verify tests cover unavailable Projects, delayed starts, tab switches during startup, revision rotation, stale completions, and no duplicate checkout or session.

## 3. Generate as input to the live agent

- [x] 3.1 Add failing walkthrough-coordinator tests proving Generate accepts a live or paused session, sends the full walkthrough prompt through `agentSessions.input()`, and never creates a second Scoped Agent Session.
- [x] 3.2 Bind each walkthrough attempt to the turn started by its Generate prompt and treat the matching scoped Stop lifecycle event as normal completion; verify ready, no-submissions, rejected-only, provider failure, and stale-turn cases transition exactly once.
- [x] 3.3 Preserve terminal outcomes and retry without a Stop button; verify host abort or unsuccessful provider exit marks the active attempt aborted or failed, keeps partial steps provisional, retains terminal output, and allows a later Generate attempt.
- [x] 3.4 Remove the coordinator rule that rejects running sessions and retire Generate-owned session startup; verify the focused generation, workspace, prompt, and attempt-state suites contain no fallback that launches a second session.

## 4. Reliable renderer-local terminal mounting

- [x] 4.1 Add a failing integration test that mounts through the real frontend Agent Sessions API with a rune-derived Session Scope; verify the test reproduces or guards against structured-clone failure and proves the `HTMLElement` and disposable never enter IPC.
- [x] 4.2 Normalize Session Scope fields into plain data at the frontend API boundary and keep terminal acquisition, attachment, and disposal renderer-local; verify typed IPC receives only cloneable scope values.
- [x] 4.3 Preserve owner-scoped Terminal Runtime coordination while fixing the mount path; verify live output, retained replay, direct input, focus, resize, stale-instance filtering, one current attachment, and generation-safe detach tests pass.

## 5. Terminal-only pull request UI

- [x] 5.1 Add failing Agent-tab component tests for one full-height Task-Agent-style terminal frame and the absence of a session header, Stop action, generation prose, retry form, textarea, and Send button.
- [x] 5.2 Reduce the Agent tab to terminal attachment ownership plus passive in-frame startup or error states; verify scope replacement and `onDestroy` dispose only the current attachment and never abort or release the session.
- [x] 5.3 Add the Generate walkthrough action to the pull request header while Agent is active; verify it sends the prompt, disables during startup or an active attempt, remains unavailable without a local Project, and becomes available after every terminal attempt outcome.
- [x] 5.4 Remove obsolete Agent-tab props, separate follow-up submission, Stop wiring, status helpers, and dead tests; verify direct TTY input remains functional and no replacement Stop control appears in the pull request detail Agent view.

## 6. Affected-system validation

- [x] 6.1 Run `pnpm --filter @openforge-app/plugin-github-sync test`, `pnpm --filter @openforge-app/plugin-github-sync typecheck`, and `pnpm --filter @openforge-app/plugin-github-sync build`; verify the plugin UI, controller, generation, storage, and production bundle pass.
- [ ] 6.2 Run the focused renderer terminal and plugin-host suites, then `pnpm packages:test`, `pnpm packages:build`, `pnpm packages:contract:check`, `pnpm electron:contract:check`, `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm lint`; verify the Terminal Runtime, Plugin SDK, Electron boundary, and desktop renderer are clean.
  - Validation note: the focused renderer and Terminal Runtime suites, builds, contracts, typecheck, and lint pass. Both aggregate test commands reach the unrelated `AnchoredMenu.browser.test.ts` split-button case and time out after 30 seconds; the remaining 7,145 root tests pass.
- [x] 6.3 From the Backend Crate root returned by `node scripts/rust-sidecar-layout.mjs backend-crate-root`, run `cargo test` and `cargo clippy`; verify scoped lifecycle authorization, database transitions, PTY identity fencing, policy hooks, and Task-session isolation pass.
- [x] 6.4 Run `openspec validate make-pr-review-agent-terminal-only --strict` and record all checks, skipped platform-only coverage, and remaining gaps in the implementation handoff.
