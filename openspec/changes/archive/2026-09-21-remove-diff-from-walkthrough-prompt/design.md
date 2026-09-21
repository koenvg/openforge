## Context

See [proposal.md](./proposal.md) for the motivation. The GitHub Sync backend already loads the complete GitHub file set before generation so it can build the immutable walkthrough validation snapshot. It then passes those same file records to the prompt compiler, which currently serializes every parsed patch hunk and its full diff text.

The scoped Agent Session runs in a detached worktree at the pull request head. The generation request already carries the pull request base ref, but the compiler does not use it. Step submissions still need the exact GitHub file paths and zero-based hunk indexes because the host validates them against the captured snapshot.

## Goals / Non-Goals

**Goals:**

- Make prompt size depend on changed-file metadata rather than patch length.
- Give the agent enough repository context to inspect the pull request change from the checkout.
- Preserve exact coordinates for walkthrough-step submission.
- Keep all existing Jira, guidance, comment, command, and Review Thread context.

**Non-Goals:**

- Change walkthrough storage, validation, or submission commands.
- Add a second command for reading pull request patches.
- Change the scoped workspace lifecycle or fetch behavior.
- Change the generated walkthrough UI or step model.

## Decisions

### Replace patch sections with JSON Lines manifest entries

The prompt compiler will render one JSON object per authoritative GitHub file. Each entry will retain the current path, rename source when present, status, addition and deletion counts, and valid zero-based hunk indexes. JSON encoding keeps filenames unambiguous even when they contain punctuation or line breaks. The prompt will omit every patch line and diff fence.

The compiler will keep using the loaded `PrFileDiff` records that also feed validation. This is smaller than adding another prompt-specific model, and it keeps rename and status metadata in one place. The existing hunk parser will provide the ordered indexes without serializing each hunk's text.

An alternative was to remove the changed-file section completely. That would make instructions smaller, but the agent could submit paths or indexes that differ from the host's GitHub snapshot and would have to recover through CLI rejections. The compact manifest avoids that failure mode at little cost.

### Tell the agent how to use the scoped checkout

`WalkthroughPromptInput` will include the pull request base ref. The backend already receives this value and will pass it to the compiler. The template will state that the patch is intentionally absent, identify the base ref, and direct the agent to inspect the change with Git and repository reads from the current checkout.

The manifest remains the authority for submission coordinates. Repository inspection supplies content and history. This separation matters because local Git output explains the change, while the host snapshot decides which path and hunk indexes it accepts.

An alternative was to add a hidden plugin command that returns patches on demand. That recreates the same payload through another channel and adds authorization and command-contract work without using the workspace already provided to the agent.

### Prove omission with content-based tests

Prompt tests will place a distinctive line in a multi-hunk patch, then assert that the output contains the file metadata and indexes but not the distinctive patch content or diff fences. A delimiter-bearing filename will verify that each file remains one unambiguous JSON entry. Separate assertions will cover the base ref and workspace-inspection instruction. Existing contract tests will continue to cover the CLI commands, guidance, Jira context, and existing comments.

This is stronger than a prompt-length threshold. A fixed threshold would be brittle as guidance and ticket content change, while a forbidden patch sentinel directly tests the intended boundary.

## Risks / Trade-offs

- [Risk] A local base ref may be unavailable or older than the pull request base used by GitHub. -> The prompt names the base ref but keeps the GitHub-derived manifest authoritative for submissions. CLI validation continues to reject mismatched coordinates without storing partial steps.
- [Risk] Removing inline patches makes the agent spend tool calls to inspect the change. -> The scoped checkout exists for this purpose, and the prompt points the agent directly to repository inspection instead of making it rediscover that context.
- [Risk] Prompt formatting and validation could disagree about hunk counts. -> Keep the existing parser-backed index generation and retain focused multi-hunk tests alongside the validation tests.

## Migration Plan

No stored data or public contract needs migration. Ship the prompt and compiler changes together. Rollback restores the previous template and formatter without touching existing walkthrough records.
