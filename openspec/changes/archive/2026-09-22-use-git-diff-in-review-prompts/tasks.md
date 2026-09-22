## 1. Define the prompt contract

- [x] 1.1 Add focused prompt-compiler tests for the missing Changed Files section, dynamic base-branch naming, three-dot merge-base inspection, changed-file summary and full-diff commands, and the warning against latest-commit-only review; run `pnpm --filter @openforge-app/plugin-github-sync exec vitest run --config vitest.config.ts src/lib/walkthroughPrompt.test.ts` and confirm the new assertions fail before implementation.
- [x] 1.2 Add focused tests proving the submission-coordinate block contains only JSON-encoded `filename` and `hunk_indexes` values, still handles delimiter-bearing filenames, omits patch and file-summary metadata, and appears with the walkthrough submission contract; run the focused prompt test and confirm the new assertions fail before implementation.

## 2. Generate the revised review prompt

- [x] 2.1 Rewrite the built-in prompt's checkout instructions to remove `## Changed Files`, identify the supplied pull request base branch, require changed-file summary and full three-dot diff inspection against `HEAD`, retain history tools, and reject latest-commit-only review; verify the focused prompt test passes for `main` and a non-default base branch.
- [x] 2.2 Replace the changed-file manifest formatter and placeholder with a submission-coordinate formatter that emits only `filename` and authoritative `hunk_indexes`, then place and describe that block beside step submission; verify the focused prompt test passes, including unusual filenames and metadata omission.

## 3. Validate the affected plugin

- [x] 3.1 Run `pnpm --filter @openforge-app/plugin-github-sync test` and `pnpm --filter @openforge-app/plugin-github-sync typecheck`; verify the complete GitHub Sync test suite and TypeScript check pass.
- [x] 3.2 Run `openspec validate use-git-diff-in-review-prompts --strict`; verify the completed change artifacts and delta spec pass strict validation.
