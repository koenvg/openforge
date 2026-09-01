## Context

The shared Markdown renderer already resolves repository-relative paths and separates their query or fragment suffix. In task Review, that path flows through the rich diff into `selfReviewNavigationController`, which invokes the file-viewer plugin and routes to its project-level view. The file-viewer plugin only consumes project-scoped filesystem APIs, so it reads the project checkout even when Review is displaying a task worktree or a selected commit. The suffix is dropped at the task navigation boundary.

The Review content loader can already fetch a path from either the current task review workspace or a selected commit. The file-viewer plugin already owns file-tree, search, preview, media, and per-project state behavior. The solution should reuse those owners rather than introduce a host-owned second file browser or import plugin internals into the host.

## Goals / Non-Goals

**Goals:**

- Keep repository-link navigation inside the task and preserve the revision represented by Review.
- Reuse the file-viewer plugin for project and live task-worktree browsing.
- Add task filesystem access through a typed, path-confined plugin API.
- Keep navigation targets explicit so project and task state cannot leak into each other.
- Preserve diff scroll, filters, selected commit, comments, and file-tree state while a linked-file preview is open.

**Non-Goals:**

- Editing files from either file viewer.
- Browsing a full historical commit tree from the task Files tab.
- Turning the Review preview into a second general-purpose file explorer.
- Changing project Files behavior or the meaning of existing project-scoped filesystem calls.
- Supporting links outside the repository workspace.

## Decisions

### Use layered navigation based on the target

Review will resolve a repository link to a structured target containing the repository path and suffix. It will then choose one of two local behaviors:

1. If the path is present in the displayed diff, scroll to that file and apply the suffix when possible.
2. Otherwise, open a review-local read-only preview in the central Review region.

The preview will have a close or back action and an "Open in Files" action. Opening and closing it will not destroy or recreate the diff workspace, so the existing diff position and state remain intact.

A single rule that always opens Files was rejected because it loses the reviewed revision and interrupts review. A rule that previews every target was rejected because changed-file links are faster and clearer when they jump directly within the diff.

### Bind Review previews to the active review revision

The preview will use the existing task review content source. With no selected commit, it reads the target's current content from the task review workspace. With a selected commit, it reads the target from that commit. Missing content is an error in that revision and never triggers a project-checkout fallback.

The task Files tab intentionally has different semantics. It always represents the live task workspace. Its header or empty state will make that scope visible, especially when the user arrived from a historical Review preview.

Making task Files revision-aware was rejected because it would require historical directory listing, search, and state semantics that are not needed for linked-file review.

### Keep file browsing plugin-owned through a source adapter

The file-viewer plugin will register its existing project view and a new task workbench tab. Its browser controller will depend on a plugin-owned file source interface rather than directly constructing project-scoped requests. The project source will retain current behavior; the task source will use the new task filesystem API.

File-browser state will be keyed by an explicit workspace identity such as `project:<projectId>` or `task:<taskId>`. Pending reveal requests will carry the same identity. This prevents a reveal in one task from selecting a path in another task or in the project view.

Duplicating the file browser under `src/components/task-detail` was rejected because it would split ownership of tree loading, search, preview, media handling, errors, and accessibility.

### Add an explicit task namespace to the filesystem API

The plugin SDK will add task-scoped read-directory, read-file, and search-files operations alongside the existing project methods. The task operations take a `taskId` and repository-relative path. The host resolves the task's current workspace, confines the path to that root, and returns the same `FileEntry` and `FileContent` contracts used by project operations.

An additive namespace keeps existing project request shapes compatible and makes scope visible at call sites. Overloading `projectId` with a worktree path was rejected because it weakens authorization and path confinement. A file-viewer-specific backend was rejected because task filesystem access is a general trusted-plugin capability and a private backend would duplicate host media classification and safety checks.

### Route reveal requests with an explicit workspace target

The file-viewer command contract will gain a task-targeted route while retaining the existing project reveal behavior. A task reveal includes the task identity, repository path, and suffix. The plugin records the reveal against that task's state and activates its own task tab through the public navigation API. Existing project quick-open callers remain project-scoped.

The Review controller will no longer route repository links through the project Files view. It will invoke task Files only when the user chooses "Open in Files."

### Carry suffixes as structured navigation data

Repository path and suffix will remain separate after Markdown resolution. File lookup uses only the path. The fragment is applied after the target content mounts, using stable heading or element identifiers. Query text remains attached to the navigation target but does not affect filesystem lookup. Destinations that cannot interpret a suffix retain it without failing the file open.

Passing a concatenated path was rejected because query and fragment text can corrupt filesystem lookup and encourages later boundaries to discard navigation intent.

### Fail within the selected scope

Task filesystem failures and Review preview failures will render local error states with retry or close actions where appropriate. They will not fall back to project content. This makes a missing historical file distinguishable from a similarly named file in another checkout.

## Risks / Trade-offs

- [The task filesystem API expands a security-sensitive boundary] -> Reuse project path normalization and confinement, reject absolute and escaping paths, and add Rust plus frontend contract tests.
- [Review preview content can become stale while the worktree changes] -> Key loads by task, review revision, path, and request generation; ignore stale responses and allow retry.
- [Task and project file-browser state can bleed through shared stores] -> Key every state and pending reveal by explicit workspace identity and test rapid scope switching.
- [Historical Review and live task Files can show different content] -> Label the task Files scope as the live worktree and keep the Review preview bound to the selected commit.
- [Fragment targets may not exist in rendered content] -> Open the file successfully, retain the fragment, and avoid treating an unresolved fragment as a file-load failure.
- [The task tab adds another workbench tab and shortcut pressure] -> Use normal plugin task-tab ordering and let the existing host shortcut assignment remain authoritative.

## Migration Plan

1. Add and validate the task-scoped filesystem SDK contract and host implementation without changing existing callers.
2. Refactor the file-viewer plugin behind project and task file sources, then register the task Files tab with isolated state.
3. Add explicit task reveal routing and keep the existing project reveal path compatible.
4. Add Review-local target routing and previews, then remove the current automatic project-view navigation for repository links.
5. Validate plugin SDK, file-viewer, renderer Review, desktop command, and Rust workspace-boundary behavior before release.

Rollback can remove the task tab and Review-local route while leaving the additive task filesystem API unused. No persisted data migration is required; incompatible in-memory or local browser state can be ignored or reset by workspace identity versioning.
