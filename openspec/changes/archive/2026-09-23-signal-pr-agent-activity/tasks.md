## 1. Shared Tabs Support

- [x] 1.1 Add failing Plugin SDK `Tabs` tests for trailing tab content, an explicit accessible-label override, legacy text/icon rendering, and unchanged selection behavior; verify the focused `Tabs.test.ts` run fails for the missing API.
- [x] 1.2 Implement the optional generic `trailing` and `ariaLabel` tab fields without changing existing callers, then verify `pnpm --filter @openforge-app/plugin-sdk test -- src/ui/Tabs.test.ts` passes.

## 2. Review-Agent Attention State

- [x] 2.1 Add failing GitHub Sync controller tests for queued/starting/active running detection, idle connected sessions, every stopped outcome, simultaneous older unread and newer running work, exact-head isolation, persisted read and unread restoration, conservative first load, storage failures, and stale asynchronous acknowledgements; verify the focused test run fails before implementation.
- [x] 2.2 Implement the dedicated attention controller and versioned per-scope plugin-storage receipt, including serialized scope-safe mutations and conservative in-memory fallback; verify the focused controller tests pass.
- [x] 2.3 Wire receipt cleanup to explicit PR session release and head rotation while retaining receipts across navigation and ordinary disposal; verify tests cover removal, rotation, and re-observation of the same scope.

## 3. Presentation Acknowledgement

- [x] 3.1 Add failing `AgentTab` tests for readiness after successful attachment and not-ready notifications before replacement, failed attachment, detach, and destruction; verify the focused `AgentTab.test.ts` run fails before implementation.
- [x] 3.2 Implement the terminal-readiness callback while preserving serialized attachment ownership and `onDestroy` teardown, then verify the focused Agent tab tests pass.
- [x] 3.3 Wire active-tab state, terminal readiness, document visibility, and window focus into the attention controller; add workspace tests proving all four gates are required and that becoming visible and focused acknowledges only the captured unread turn, then verify the focused workspace tests pass.

## 4. Agent Tab Signals

- [x] 4.1 Add failing pull request detail tests for running-only, unread-only, combined, and idle states, including the computed accessible tab names and unchanged tab selection behavior; verify the focused PR view test run fails before implementation.
- [x] 4.2 Implement the compact broken-ring running signal and solid-dot unread signal with semantic tokens, hidden decorative visuals, stable two-signal layout, and a reduced-motion rule that freezes the ring; verify the focused PR view and Tabs tests pass.

## 5. Validation

- [x] 5.1 Run the full Plugin SDK checks with `pnpm --filter @openforge-app/plugin-sdk test`, `pnpm --filter @openforge-app/plugin-sdk build`, and `pnpm --filter @openforge-app/plugin-sdk check:contract`; verify all commands pass.
- [x] 5.2 Run the full GitHub Sync checks with `pnpm --filter @openforge-app/plugin-github-sync test`, `pnpm --filter @openforge-app/plugin-github-sync typecheck`, and `pnpm --filter @openforge-app/plugin-github-sync build`; verify all commands pass.
- [x] 5.3 Run `pnpm lint` and `openspec validate signal-pr-agent-activity --type change --strict --no-interactive`; verify both pass and record any unrelated pre-existing failures if encountered.
