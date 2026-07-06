# Continue an existing Claude session from a new task (AVIV-169)

## Goal

Let a user start a Claude session in their terminal, then create an OpenForge task
that **continues that existing local session** instead of starting fresh. The user
picks the session from a list inside the New Task dialog.

Use case: begin a session locally (or on the go), come back and drive it from
OpenForge's task board with all the worktree/agent supervision OpenForge provides.

## Scope (POC)

- **Local sessions only.** Cloud / mobile / `--teleport` sessions are explicitly out.
- **Claude only.** The picker is shown only when the task's project is configured
  with the `claude-code` provider. OpenCode/Pi are natural future extensions
  (they already have `*_session_id` fields); Codex has no session IDs and stays
  unsupported.
- No editing/deleting sessions from the picker. Read + select only.

## Background (verified in code)

- OpenForge spawns the `claude` CLI over a PTY. `build_claude_args()`
  (`src-tauri/src/pty_manager/commands.rs`) already emits `--resume <id>`.
- `ClaudeCodeProvider::start()` (`src-tauri/src/providers/claude_code.rs`) currently
  passes `None` for the resume id; `resume()` passes the stored
  `agent_sessions.claude_session_id`.
- Claude session transcripts live at
  `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The **filename is the
  session id**. Encoding replaces every non-alphanumeric char in the absolute cwd
  with `-` (e.g. `/Users/x/repos/1-collibra/openforge` →
  `-Users-x-repos-1-collibra-openforge`).
- Each `.jsonl` yields clean labels: `ai-title` records (`aiTitle`), `last-prompt`
  records (`lastPrompt`), plus per-record `cwd`, `gitBranch`, `version`, `timestamp`.

## Key design decision: transcript resolution

A new task runs in a **fresh worktree**, but the picked session was recorded in a
**different directory** (usually the main checkout). `claude --resume <id>` looks in
the *current* project dir first.

**Chosen approach (A):** Before launching, copy the session's `.jsonl` into the
worktree's project dir
(`~/.claude/projects/<encoded-worktree-cwd>/<session-id>.jsonl`). Then
`claude --resume <id>` finds it deterministically, independent of Claude's
git-worktree scoping or version. This is Anthropic's documented cross-directory
method. Copy is idempotent and never clobbers an existing file.

Rejected approach (B): rely on Claude's built-in worktree scoping — unproven for
OpenForge's worktree layout, version-dependent, can fail with "No conversation
found".

A validation spike (resume from a worktree with the copied transcript) is the first
implementation step.

## Components

### 1. Session enumeration (Rust)
New module `src-tauri/src/claude_sessions.rs`:
- `encode_project_dir(cwd: &Path) -> String` — the non-alphanumeric→`-` encoding.
- `ClaudeSessionSummary { session_id, title, last_prompt, cwd, git_branch, updated_at, message_count }`.
- `list_sessions(project_root: Option<&Path>) -> Vec<ClaudeSessionSummary>` — scans
  `~/.claude/projects/*/*.jsonl`, streams each file to extract fields, filters to
  sessions whose recorded `cwd` is within `project_root` (when provided), sorts by
  `updated_at` desc.
- `resolve_transcript_path(session_id) -> Option<PathBuf>` and
  `copy_transcript_into_worktree(session_id, worktree: &Path) -> Result<..>` (idempotent).

Pure/fs-only functions → unit-testable with temp dirs + fixture `.jsonl`.

### 2. IPC command
`list_claude_sessions(projectRoot?)` → `Vec<ClaudeSessionSummary>`, wired through the
existing app_invoke dispatch. Frontend wrapper `listClaudeSessions()` in
`src/lib/ipc.ts`; type in `src/lib/types.ts` and `packages/plugin-sdk` domain as needed.

### 3. Data model
Add nullable `resume_session_id TEXT` to `tasks` (new migration). Thread through
`TaskRow`, `NewTaskOptions`, the Electron IPC `create_task` payload, and the
`domain.ts` Task interface. The OpenForge CLI / HTTP-bridge `create_task` handler
(`http_server.rs`) is a separate, simpler path that does not support the richer
create options (title/worktree/etc.), so a `--resume-session-id` CLI flag is
**deferred** — the UI is the target surface for the POC.

### 4. Launch path
`handle_app_start_implementation_command`: if `task.resume_session_id` is set and the
resolved provider is `claude-code`, copy the transcript into the working dir, then
call the Claude provider start passing the resume id. Thread
`resume_session_id: Option<&str>` into `ClaudeCodeProvider::start` →
`spawn_claude_pty` (which already accepts it). Hooks capture the (same) session id into
`agent_sessions.claude_session_id`, so later OpenForge resumes keep working.

Prompt semantics: when resuming, the New Task prompt is optional ("next instruction —
leave blank to just continue"); empty prompt spawns `claude --resume <id>`
interactively. Default the task title to the session's title when available.

### 5. UI (AddTaskDialog.svelte)
Collapsible "Continue an existing Claude session" section, rendered only when the
selected project's provider is `claude-code`. Fetches sessions, shows selectable rows
(title · branch · relative time · prompt snippet). Selecting a session sets
`resumeSessionId`, makes the prompt optional, and prefills the title.

## Testing (TDD)
- Rust: transcript field extraction from a fixture `.jsonl`; `encode_project_dir`;
  project-root filtering; idempotent copy-into-worktree; `build_claude_args` resume+prompt.
- Frontend: session summary mapping/sort/filter + provider-gating logic only.
  No CSS/visual assertions (repo rule).

## Out of scope / follow-ups
- Cloud/mobile (`--teleport`, `--remote-control`).
- OpenCode/Pi/Codex session continuation.
- Session search/preview pane, deleting sessions.
