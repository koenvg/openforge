## 1. Lock the prompt boundary with tests

- [x] 1.1 Add a failing multi-hunk prompt test that asserts changed-file metadata and valid hunk indexes remain while patch lines and diff fences are absent; verify the focused `walkthroughPrompt.test.ts` run fails for the expected embedded-patch behavior.
- [x] 1.2 Add failing prompt and backend assertions for the pull request base ref and scoped-workspace inspection instruction, while retaining the existing Jira, guidance, comment, step-command, and Review Thread contract assertions; verify the focused tests fail only on the missing compact-prompt behavior.

## 2. Compile compact walkthrough instructions

- [x] 2.1 Replace full per-hunk diff rendering with one-line changed-file manifest entries that preserve rename, status, change counts, and valid zero-based hunk indexes; verify the focused prompt tests pass.
- [x] 2.2 Pass the pull request base ref into prompt compilation and update the template to direct the agent to inspect the change in its scoped checkout while treating the manifest as authoritative for submission coordinates; verify the focused prompt and backend tests pass.

## 3. Validate the affected plugin

- [x] 3.1 Run the GitHub Sync plugin's full `test`, `typecheck`, and `build` scripts, then run `git diff --check`; record any skipped check or remaining gap before completion.
