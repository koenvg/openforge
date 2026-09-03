## 1. Subagents in transcript replay

- [x] 1.1 Add a failing test asserting that an async `Agent` result, `agentId` with `isAsync: true`, is pending background work; verify it fails against current behaviour
- [x] 1.2 Add a failing test asserting that a synchronous `Agent` result, `agentId` with no `isAsync`, is not pending
- [x] 1.3 Add a failing test asserting that a pending subagent is dropped once its stop is announced under the same identifier
- [x] 1.4 Make 1.1 to 1.3 pass by recognising the subagent result shape with no declared expiry; verify with `cargo test claude_background_work` from the backend crate root

## 2. Read the reported inventory

- [x] 2.1 Add the `background_tasks` field to the Claude hook payload model as untyped JSON, and verify a payload carrying a malformed inventory still deserializes rather than rejecting the hook
- [x] 2.2 Add failing tests for the inventory reader: a running entry is outstanding, a pending entry is outstanding, an entry whose state is neither is not, an entry of an unrecognised kind is outstanding, an entry missing its kind or state is outstanding
- [x] 2.3 Add failing tests asserting teammate entries are excluded: a teammate-only inventory is not outstanding, a teammate alongside a running subagent leaves the subagent outstanding
- [x] 2.4 Add failing tests asserting an empty inventory means no outstanding work, an absent field is distinguishable from an empty one, and an entry whose fields cannot be read still counts as outstanding
- [x] 2.5 Implement the inventory reader and verify 2.2 to 2.4 pass with `cargo test` from the backend crate root

## 3. Wire the decision point

- [x] 3.1 Add a failing test asserting that a `stop` event whose payload reports a running subagent leaves the session `running` rather than `completed`
- [x] 3.2 Add a failing test asserting that a `stop` event whose payload omits the inventory falls back to transcript replay and still defers on a pending subagent
- [x] 3.3 Add a failing test asserting that a `stop` event whose payload reports an empty inventory completes the session even when the transcript still shows a stale pending item
- [x] 3.4 Make the inventory the preferred source in the deferral decision with transcript replay as the fallback, and verify 3.1 to 3.3 pass
- [x] 3.5 Carry the deferral's source into the completion watcher so an inventory-sourced deferral is not re-derived from the transcript at its deadline, guarded by a test that fails without it
- [x] 3.6 Verify the existing shell and monitor deferral tests still pass unchanged with `cargo test` from the backend crate root

## 4. Full validation

- [x] 4.1 Run the backend crate's full suite and static checks from the backend crate root: `cargo test`, `cargo clippy`, `cargo check`
- [x] 4.2 Confirm every scenario in `specs/claude-background-work/spec.md` maps to a test, and record any scenario left uncovered with the reason
- [ ] 4.3 Drive the real app with a task whose agent launches a backgrounded subagent, and confirm the board keeps the task in Doing with a running session until the subagent reports, then completes
- [ ] 4.4 Exercise the fallback path against a payload with the inventory field stripped, and confirm the task still stays running on a pending subagent
