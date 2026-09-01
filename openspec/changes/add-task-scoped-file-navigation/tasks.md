## 1. Task-scoped filesystem contract

- [ ] 1.1 Add failing plugin SDK contract and fake-runtime tests for task directory listing, file reading, file search, unavailable workspaces, and project-call compatibility; implement the additive task filesystem namespace and verify `pnpm --filter @openforge-app/plugin-sdk test` passes.
- [ ] 1.2 Add failing renderer capability-adapter and typed IPC tests for task-scoped filesystem requests; wire task IDs and repository-relative paths through the public frontend API and verify the focused adapter and IPC test files pass with `pnpm test <test-paths>`.
- [ ] 1.3 Add failing Rust tests for resolving a task workspace, listing directories, reading classified text/image/video/binary content, searching files, and rejecting absolute or escaping paths; implement the task filesystem command boundary and verify the focused Rust tests pass with `cd "$(node scripts/rust-sidecar-layout.mjs backend-crate-root)" && cargo test <filter>`.
- [ ] 1.4 Register the new desktop commands and generated IPC contract entries while preserving existing project filesystem payloads; verify `pnpm electron:contract:check`, the relevant Electron/preload contract tests, and `pnpm --filter @openforge-app/plugin-sdk check:contract` pass.

## 2. Task Files tab and isolated browser state

- [ ] 2.1 Add tests that describe project and task file sources, then refactor the file-viewer controllers to consume a workspace file-source interface without changing project Files behavior; verify `pnpm --filter @openforge-app/plugin-file-viewer test` passes.
- [ ] 2.2 Add scope-isolation tests for selected paths, expanded directories, searches, scroll positions, and pending reveals keyed by project or task identity; implement scoped state storage and verify rapid project/task switching does not leak state in the file-viewer test suite.
- [ ] 2.3 Add a failing registration and component test for a task workbench Files tab; register the tab, connect it to the task filesystem source, show live-worktree identity and workspace errors, and verify the file-viewer registration and task-tab tests pass.
- [ ] 2.4 Add tests for an explicit task-targeted reveal request carrying task ID, path, and suffix; implement plugin-owned task-tab activation while keeping existing project quick-open behavior compatible, and verify command-routing tests pass.

## 3. Review-local repository link navigation

- [ ] 3.1 Add shared Markdown and rich-diff tests for a structured repository link target whose path is separate from its fragment or query suffix; carry that target through component callback contracts and verify the plugin SDK and PR review UI focused tests pass.
- [ ] 3.2 Add failing Review navigation-controller tests for links to displayed diff files versus other repository files; implement changed-file scrolling and review-preview state without project-view navigation, then verify controller and workspace tests pass.
- [ ] 3.3 Add content-loader tests for Review previews from the live task review workspace and a selected commit, including missing files, stale async responses, and no project fallback; implement the revision-bound preview loader and verify the focused loader tests pass.
- [ ] 3.4 Add component tests for opening and closing the Review preview while retaining diff scroll, filters, selected commit, comments, and file-tree state; build the read-only preview with loading, error, retry, close, and back behavior and verify the task Review tests pass.
- [ ] 3.5 Add tests for the Review preview's "Open in Files" action; route it to the same task's live Files tab with the target selected and verify historical Review content is never presented as live Files content.
- [ ] 3.6 Add fragment and query-suffix navigation tests for changed-file jumps, Review previews, and task Files; apply resolvable fragments after content mounts, retain unresolved suffixes without failing file loads, and verify the focused Markdown and navigation tests pass.

## 4. Cross-boundary verification

- [ ] 4.1 Add integration tests covering a repository link to a displayed changed file, an unchanged worktree file, a historical commit file, a missing target, and a task Files reveal across two task worktrees; verify all new scenarios pass under `pnpm test`.
- [ ] 4.2 Run full affected-system frontend and plugin validation with `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm electron:contract:check`, `pnpm --filter @openforge-app/plugin-sdk build`, `pnpm --filter @openforge-app/plugin-sdk check:contract`, and `pnpm --filter @openforge-app/plugin-file-viewer build`; record any coverage gap.
- [ ] 4.3 Run full affected Rust validation from `$(node scripts/rust-sidecar-layout.mjs backend-crate-root)` with `cargo test`, `cargo check`, and `cargo clippy`; confirm task path confinement and existing project filesystem behavior remain covered.
