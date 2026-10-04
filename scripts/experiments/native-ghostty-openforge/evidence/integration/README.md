# Existing-session integration evidence

This directory supplements, rather than overwrites, the earlier prerequisite evidence.

- `native/report.json` and adjacent logs: current 12-check native runner, including pending-output shutdown and the full 3,326-pass/16-skip native suite.
- `live-session.json`, `live-session-final.log`: latest actual-app probe; all five assertions passed and the verified fixture process tree was stopped afterward. No native pixel claim.
- `live-session-async.log`, `fallback-suffix.png`: earlier strict fallback failure. The screenshot is Chromium's xterm fallback, not native Metal. It shows `FALLBACK-RECOVEREDE`; the expected whole line was `FALLBACK-RECOVERED`. The failing report was overwritten by a later run, so this log/screenshot and the findings document preserve the failure, not a reconstructed report. Passing later does not explain this discrepancy.
- `async-regressions.json`: synchronous notification flood timed out as expected; the first pending-output shutdown implementation also timed out unexpectedly. The ad hoc Bun-backed process wrapper did not fully stop its Electron children; verified owned descendants were subsequently stopped. Use explicit Node and verify process cleanup, rather than assuming a timeout stopped the tree.
- `async-regressions-green.json`: both normal and pending-output quit probes passed after switching native wakeups to libuv. The full native runner subsequently repeated these checks.
- `integration-checks.json`, `integration-fix-checks.json`, `validation-summary.json`: broad/focused checks and full-log hashes. Initial missing-mock-export/domain failures were corrected. A later generated-registry stale result was corrected by regeneration. Final static checks pass. The complete app-suite retry timed out; do not report a clean aggregate app-suite pass.
- `backend-checks.json`, `backend-retry.json`: an initial unrelated document-preview timeout, followed by a complete four-thread passing backend test run. Check and Clippy passed.

Further raw logs are retained under ignored `artifacts/terminal-presentation/native-ghostty-openforge/`. The WIP checkpoint on `openforge/KVG-5198` remains incomplete pending restoration consistency, visual acceptance, clean aggregate validation and the required single fresh completion review.
