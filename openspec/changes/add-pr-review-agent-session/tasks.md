## 1. Shared address and stable Agent tab

- [x] 1.1 Add `reviewScopeForPullRequest` as the only GitHub Sync constructor for `{ namespace: 'github', targetKey: 'gh:<owner>/<repo>#<number>', revision: head_sha }`, replace the adapter's private target-key builder, and verify focused tests prove sessions and Review Threads receive the same exact triple and a new head gets a new revision
- [x] 1.2 Add `agent` to both pull request detail tab-id unions, render Agent as the always-present third tab and Walkthrough as conditional fourth, and update keyboard navigation; verify component tests cover no session, no local Project, an available walkthrough, and stable `Cmd/Ctrl+3` and `Cmd/Ctrl+4` behavior
- [x] 1.3 Build the Agent tab's empty, unavailable, live, retained-output, failed, and completed states around the scoped Agent Sessions API; verify UI tests prove the tab stays present and reports why a repository without a local Project cannot start
- [x] 1.4 Mount the host terminal by logical Session Scope without releasing prop-keyed resources from `$effect` cleanup, dispose only the current attachment from `onDestroy`, and verify rerender, pull-request switch, stale-disposer, and destroy tests cannot detach, resize, abort, or release a replacement session

## 2. Pull request scoped-session controller

- [x] 2.1 Add a GitHub Sync controller that starts `review-read-only` in the Project repository at `head_sha`, reads status, subscribes to invalidations, sends later input, aborts active work, and explicitly releases removed or superseded scopes; verify fake-backed tests cover start, queue, live input, completion, failure, abort, pull request removal, and revision rotation
- [x] 2.2 Route Agent-tab input through scoped-session input so a completed review continues the same provider conversation and Scoped Workspace; verify a controller test sends two turns to one scope and never starts a second session record
- [ ] 2.3 Add immediate same-session follow-up routing for line and step Review Threads, with the human message stored before session input and the agent directed to answer the exact thread id; verify tests cover a successful reply, input failure without message loss, and no batched headless question run

## 3. Scope-bound walkthrough command

- [ ] 3.1 Extend scoped Plugin Command invocation context with host-derived owner plugin, Project, scoped session id, and Session Scope while leaving ordinary Task and person invocations unscoped; verify SDK, broker, frontend-host, backend-host, fake, generated-runtime, and packaged-contract tests reject caller-supplied scope and preserve existing command behavior
- [ ] 3.2 Extend `review-read-only` authorization to permit only `com.openforge.github-sync.submit-walkthrough-step` through the existing agent-allowlisted Plugin Command route, alongside scope-matching Review Thread verbs; verify policy and ingress tests reject another command, plugin, Project, session, scope, revoked credential, shell metacharacter bypass, and interactive approval of a mutation
- [ ] 3.3 Register the backend `submit-walkthrough-step` command as agent-enabled and hidden from user command discovery, with explicit input and output schemas and one corrective example; verify command catalog and invocation tests cover discoverability, schema rejection, missing scoped context, a stale attempt id, and a successful scoped call

## 4. Versioned walkthrough storage and validation

- [ ] 4.1 Replace raw `steps_json` and `walkthrough_session_key` storage with a versioned typed walkthrough record containing scope, attempt id, attempt state, ordered steps, timestamps, and error details; verify store tests round-trip every state without a provider key or raw final output
- [ ] 4.2 Add the one-release legacy walkthrough reader: rewrite valid ready records after checking every step against current complete diffs, map legacy generating to `aborted` and error to `failed`, and fail invalid legacy steps without trimming them; verify tests cover each conversion and the untouched `walkthrough:<pr-id>:<head-sha>` key
- [ ] 4.3 Build an immutable validation snapshot only after all paginated pull request files load and the head SHA is unchanged, using exact filenames and parsed hunk counts; verify tests cover 101 files, a head change during loading, pagination failure, missing patches, and refusal to start or validate from a partial snapshot
- [ ] 4.4 Implement atomic step validation for active attempt, non-empty id/title/summary/files, unique changed-file references, whole-file selection, and unique in-range zero-based hunks; verify table-driven tests assert each rejection names the field, rejected value, and correction boundary and stores no partial step
- [ ] 4.5 Upsert accepted steps by id while preserving the first accepted position, leaving rejected first submissions positionless, and publish a walkthrough invalidation after each write; verify tests cover correction in the same attempt, replacement without duplication, stable order, stale attempt fencing, and live subscriber refresh

## 5. Generation attempt lifecycle

- [ ] 5.1 Change walkthrough generation to create a fresh attempt and send one scoped-session prompt containing its opaque attempt id, exact step-command example, exact Review Thread address, and stable idempotency guidance; verify prompt tests contain no JSON output schema or instruction to encode results in final text
- [ ] 5.2 Implement `generating -> ready | no-submissions | failed | aborted` transitions fenced by attempt id and generation turn, with rejected steps excluded from the accepted count; verify deterministic tests cover normal completion with steps, zero commands, only rejected commands, provider failure, stop, stale completion, and an unrelated later conversation turn
- [ ] 5.3 Render accepted steps as provisional while generation runs, expose normal walkthrough and ticket-coverage behavior only for `ready`, and show the exact no-submissions message with a retry action while retaining the terminal; verify component tests cover live arrival, partial failure, empty completion, successful completion, and retry
- [ ] 5.4 Make Stop abort the current generation turn, mark only that attempt `aborted`, retain readable terminal output, and allow a clean new attempt in the same scoped conversation; verify tests prove partial steps never become ready and a retry cannot be overwritten by the stopped attempt

## 6. Review Threads migration and parse-path removal

- [ ] 6.1 Replace GitHub Sync's adapted `AgentReviewComment` and `AiThread` reads with `api.reviewThreads.list`, scope-specific invalidations, reply, status, awaiting, and seen operations; verify workspace and diff-viewer tests cover live agent comments, person replies, status changes, step anchors, unread answers, unrelated-scope isolation, and orphan rendering
- [ ] 6.2 Remove the local Questions batching flow and send terminal or inline follow-up questions through the same scoped session; verify no call to `askAgentQuestions` or `agentGenerateInRepo` remains in the follow-up path and focused tests preserve each user message across a failed send
- [ ] 6.3 Remove headless walkthrough generation, `walkthroughSchema.ts`, final-output extraction, `reviewCommentsParse.ts`, the review-thread adapter, obsolete records and Svelte stores, and their backend/client methods; verify negative contract tests prove the removed methods and output-schema path are no longer registered, exported, or packaged
- [ ] 6.4 Retire all reads and writes for `pr-ai-review:<pr-id>:<head-sha>`, `pr-ai-threads:<pr-id>:<head-sha>`, and `pr-review-session:<pr-id>` while leaving Jira and walkthrough keys intact; verify upgrade tests show old comments and question threads are not imported or rendered and new runs create none of the retired values
- [ ] 6.5 Preserve GitHub review submission from resolved agent-authored Review Threads and remove the legacy approved-comment mapping only after parity is covered; verify submission tests include approved inline findings once, exclude open and dismissed findings, and mark submitted threads with the agreed post-submit status

## 7. Affected-system validation

- [ ] 7.1 Run focused red-green tests throughout implementation, then run `pnpm --filter @openforge-app/plugin-github-sync test`, `pnpm --filter @openforge-app/plugin-github-sync typecheck`, and its production bundle build; verify the plugin's frontend, backend, storage, command, and visible-session paths all pass
- [ ] 7.2 Run `pnpm packages:test`, `pnpm packages:build`, `pnpm packages:contract:check`, `pnpm electron:contract:check`, `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm lint`; verify SDK, packaged runtime, Electron boundary, renderer, shared review UI, and static checks are clean
- [ ] 7.3 From the Backend Crate root returned by `node scripts/rust-sidecar-layout.mjs backend-crate-root`, run `cargo test` and `cargo clippy`; verify scope-bound credentials, Plugin Command dispatch, transport allowlisting, read-only policy, and no cross-scope write regression
- [ ] 7.4 Run `openspec validate add-pr-review-agent-session --strict` and record the complete validation scope, any platform-only checks not run, and the intentional loss of pre-change local review comments and question threads
