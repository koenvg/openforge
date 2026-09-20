## 1. Hydration state and contracts

- [ ] 1.1 Add failing persistence/migration tests for new-association pending state, legacy untracked rows, successful/partial outcomes, retained retry budgets after restart, and synthetic identity reconciliation; verify failures describe missing hydration behavior before implementation.
- [ ] 1.2 Implement the additive migration and guarded hydration persistence, including association/generation/head checks; verify migration round-trips and the tests from 1.1 pass without deleting or duplicating PR associations.
- [ ] 1.3 Add the optional typed hydration summary to PR read mappings and Plugin SDK domain types with legacy-compatible defaults; verify serialization tests cover absent, pending, partial, complete, and failed summaries and no credentials/raw GitHub errors leak into responses.

## 2. Shared detail collection

- [ ] 2.1 Add fake-GitHub tests around the existing per-PR poll path for the complete detail set, successful empty sources, one failed source, unresolved mergeability, and closed/merged manually linked PRs; verify the completeness and non-destructive partial-result tests fail before the shared outcome is added.
- [ ] 2.2 Expose a reusable single-PR refresh operation with typed source completeness and retry classification, retaining existing REST/GraphQL fallbacks and readiness rules; verify tests from 2.1 pass and existing readiness/reviewer tests stay green.
- [ ] 2.3 Make periodic and explicit refresh record compatible hydration outcomes and guard stale commits; verify old-head results cannot overwrite a newer head, failed sources preserve prior data, and a successful background/manual refresh clears prior hydration errors.

## 3. Backend scheduling and link integration

- [ ] 3.1 Add failing fake-clock coordinator tests for immediate scheduling, duplicate coalescing, bounded pending work, shared request permits, 30-second attempt timeout, two retries at 2/10 seconds, reset deadlines, authentication failure, and persistent unknown mergeability; verify request counts and persisted outcomes rather than internal layout.
- [ ] 3.2 Implement the backend hydration coordinator and bounded startup/pending recovery using persisted eligibility and attempt counts; verify tests from 3.1 pass, capacity is released during delays, and restart neither loses work nor resets retry budgets.
- [ ] 3.3 Signal hydration after automatic-discovery and explicit-link commits without blocking link visibility; verify integration tests receive the initial association event before a delayed detail response and then observe full details without advancing a periodic polling clock.
- [ ] 3.4 Connect recovery reconciliation and coalesce with same-cycle polling and concurrent manual refresh; verify a new recovery association hydrates once, an already complete association does not restart initial hydration, and incomplete work remains recoverable.
- [ ] 3.5 Complete race and invalidation coverage for deletion, reassignment, head advance, synthetic-to-canonical identity, hidden tasks, and hydration-only state changes; verify outdated operations cannot restore links or overwrite newer data, and successful completion emits an update even when CI/review summaries are unchanged.

## 4. Task PR presentation

- [ ] 4.1 Add failing GitHub Sync component/client tests for initial fetching, partial results, retry exhaustion, rate-limit/authentication explanations, genuine unknown readiness, legacy missing state, and retained data during a later failure; verify assertions concern visible behavior rather than CSS.
- [ ] 4.2 Render hydration feedback in the existing task PR card without hiding its URL or available metadata, and preserve merge/enqueue eligibility rules; verify tests from 4.1 pass and the existing manual-refresh control remains usable.
- [ ] 4.3 Keep event consumers as persisted-data revalidation only; verify pushed hydration updates populate the card without remote-refresh loops, and task switches/remounts cannot inherit another task's loading/error state.

## 5. Affected-system validation and handoff

- [ ] 5.1 Run the first-link-to-populated-card integration scenarios for automatic, manual, and reconciliation paths, including a partial failure followed by recovery; verify no manual action, panel mount, or periodic tick is needed for initial success and document observed behavior.
- [ ] 5.2 Run full Rust sidecar `cargo test`, `cargo check`, `cargo build`, and `cargo clippy` from the crate resolved by `scripts/rust-sidecar-layout.mjs`; verify each succeeds or record the exact environmental blocker and coverage gap.
- [ ] 5.3 Run GitHub Sync plugin `test`, `typecheck`, and build, Plugin SDK `test`, build, and `check:contract`, plus renderer `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm lint`; verify all affected subsystem scripts pass and report any skipped checks.
- [ ] 5.4 Run `pnpm electron:contract:check` and applicable package/event contract checks; if shared companion mappings change, also run `pnpm mobile:contract:check`. Verify public hydration summary compatibility and record the complete affected-scope result.
- [ ] 5.5 Validate this OpenSpec change and update KVG-5125 Handoff Notes through the workflow plugin with concise user-facing completion status and any real follow-up tasks; verify validation and the final notes replacement succeed before handing back implementation.
