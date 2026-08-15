# Add Grok (xAI `grok` CLI) as a Supported AI Provider — Design

**Date:** 2026-07-18
**Status:** Draft — awaiting review
**Task:** AVIV-117

## Problem

OpenForge lets a user run a coding agent per task. Today it supports four **providers**
(the internal term for a harness/CLI agent): `claude-code`, `codex`, `opencode`, `pi`.
We want to add a fifth, **`grok`** — xAI's Grok Build CLI (`grok`, https://x.ai/cli) —
so a user can select Grok, have it detected as installed, launch it in a task's worktree,
see its live status, and resume a session.

## What "supporting a provider" means here

A provider is a string ID plus a recipe for five behaviours:

1. **Select** — appears in the Settings "AI provider" dropdown.
2. **Detect** — OpenForge runs `<binary> --version` to know it's installed.
3. **Launch** — start the CLI in the task's git worktree with the task prompt.
4. **Live status** — the "running / done" pill, driven by the CLI reporting lifecycle
   events (SessionStart / Stop / SessionEnd / permission notifications) back to
   OpenForge's local HTTP server.
5. **Resume** — continue a prior session by its session ID.

Two provider-agnostic mechanisms sit under launch/status/resume: a per-provider **PTY
adapter** (binary + args + env + a `prepare()` side-effect) and a per-provider **lifecycle
integration** (how the CLI is told to phone home).

## Feasibility summary (verified against installed `grok` 0.2.32 + bundled docs)

**Grok is the most Claude-compatible of the five providers, so this is largely a port of the
existing Claude Code integration.** Grok explicitly documents its flags as Claude Code
equivalents (`--allow` ≈ `--allowedTools`, `--system-prompt-override` ≈ `--system-prompt`,
identical `--permission-mode` values, and it even reads `~/.claude/settings.json` hooks).

| Capability | Grok mechanism (verified) |
|---|---|
| Detect | `grok --version` → `grok 0.2.32 …`; `grok models` lists models |
| Live status | Native **hooks** (`~/.grok/docs/user-guide/10-hooks.md`): events `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`, `Notification`. Hook type `"command"` (run a shell command, JSON on stdin) **or** `"http"` (POST the event envelope to a URL). Env vars on every hook: `GROK_SESSION_ID`, `GROK_WORKSPACE_ROOT`, `CLAUDE_PROJECT_DIR`. |
| Resume | `grok -r/--resume <SESSION_ID>` (or `-c/--continue`). Session IDs are UUIDv7; a client may **preset** one via `-s/--session-id` (interactive TUI only). `grok sessions list/search` also exists. |
| Launch | `--cwd <path>`, `--model <id>`, `--permission-mode <default|acceptEdits|auto|dontAsk|bypassPermissions|plan>` |
| Auth | User-managed: browser login persisted in `~/.grok/auth.json`, or `XAI_API_KEY` env. **Not OpenForge's concern** (same as Claude). |

Reference implementation to port from — existing anchors:

| Need | Existing Claude anchor |
|------|-----------------|
| Provider struct (start/resume/abort/cleanup/name/session_id/commands/agents) | `src-tauri/src/providers/claude_code.rs` |
| Enum + 8 dispatch matches + `from_name` | `src-tauri/src/providers/mod.rs:86-309` |
| PTY adapter (binary/args/env/prepare/pid) | `ClaudeCodePtyAdapter` `src-tauri/src/pty_manager/session.rs:88-167`; `spawn_claude_pty` `:525` |
| Arg builder | `build_claude_args` `src-tauri/src/pty_manager/commands.rs:7` |
| Lifecycle hooks file + workspace trust | `src-tauri/src/claude_hooks.rs` (`generate_hooks_settings`, `ensure_workspace_trusted`, `build_hooks_json`) |
| Hook HTTP endpoints + event→kind mapping | `src-tauri/src/http_server.rs:389-604`; `agent_lifecycle.rs:246-282` |
| Install check | `check_claude_installed` `src-tauri/src/runtime_checks.rs:94` |
| IPC wrapper + contract | `checkClaudeInstalled` `src/lib/ipc.ts:274-287`; `src/lib/electronMigrationContracts.ts:96-99` |
| Resume-command builder (FE) | `src/lib/agentResumeCommand.ts:3-34` |
| Status-pill config (FE) | `src/lib/agentStatusPill.ts:21-32` |
| Settings UI (list/URLs/rows) | `src/components/settings/SettingsGeneralCard.svelte:9-144` |
| DB session-id column + setter | `src-tauri/src/db/agents.rs`; migration `src-tauri/src/db/migrations.rs` |

## Scope

**In scope for this task (near-full parity):**
Select · Detect · Launch · Live status · Resume.

**Deferred to follow-up tasks** (do not block Grok being usable day-to-day; OpenForge already
ships providers without these — e.g. Pi has no roadmap drafting):
- Headless auto-title generation (`task_metadata_refresh/providers.rs`)
- Roadmap AI ticket drafting (`roadmap_ai.rs`)
- Headless `agent_generate` "print mode"
- Skills install target (`cli_installer.rs`)

## Key design decisions

### D1. Identity
- Provider ID: **`grok`**. Binary: **`grok`** (ID == binary, like codex/opencode/pi).
- Default provider is unchanged (`claude-code`).

### D2. Launch model — the one real divergence from the Claude port

OpenForge runs each provider as an **interactive TUI inside a PTY** and pre-loads the task
prompt. For Claude/Codex/Pi the prompt is passed as a **CLI argument** to the interactive TUI.
**Grok's interactive TUI has no positional prompt argument** (confirmed via `grok --help` and
the bundled zsh completion: the only top-level positional is a subcommand; `-p/--single`,
`--prompt-file`, `--prompt-json` all run *headless* and exit). So OpenForge cannot seed the
prompt the same way.

**Chosen approach: launch interactive, then inject the prompt into the PTY once the session is
ready.**
- Spawn `grok --cwd <worktree> --session-id <preallocated-uuid> [--permission-mode <m>]
  [--model <m>]` in the PTY (PTY cwd is already the canonicalized worktree, so `--cwd` is
  belt-and-suspenders).
- Use the **`SessionStart` lifecycle hook** as the readiness signal: when it fires, OpenForge
  writes the prompt text + `\r` into the PTY's input. This reuses the hook channel we're
  building anyway and avoids a fragile fixed delay.
- `--session-id <preallocated-uuid>`: OpenForge generates the session UUID up front, so it
  **knows the resume ID immediately** (store at spawn, no need to parse it from a hook).

**Spike first (step 0 of implementation):** confirm, against the real binary in a throwaway
worktree, (a) that `--session-id` is honoured in interactive mode and appears in
`grok sessions list`, and (b) the exact readiness point / timing for prompt injection
(SessionStart vs. a short retry on the input box). Fallbacks if injection proves unreliable:
inject on a bounded retry after SessionStart; or drive via ACP stdio (larger change — out of
scope, note only). This spike gates the rest of the launch work.

### D3. Lifecycle integration — global guarded command-hook

Claude receives its hooks via a per-launch `--settings <file>` flag. **Grok has no
`--settings` flag**; it discovers hooks from `~/.grok/hooks/*.json` (global, always trusted),
`<project>/.grok/hooks/*.json` (requires trust), or `~/.claude/settings.json` (Claude-compat).

**Chosen approach: install one idempotent global hook file `~/.grok/hooks/openforge.json`**
(new module `src-tauri/src/grok_hooks.rs`, mirroring `claude_hooks.rs`). Rationale:
- Global (`~/.grok/hooks/`) is **always trusted** → no per-worktree trust prompt, no writing
  hook files into the user's repo/worktree (avoids git-status pollution). This matches how
  Codex/Pi/OpenCode install their integration into the user config dir, not the repo.
- **Guarded so it is inert for the user's own Grok sessions:** each hook is a `"command"`
  hook that only curls when `OPENFORGE_TASK_ID` is set, e.g.
  `[ -n "$OPENFORGE_TASK_ID" ] && curl -s -o /dev/null -X POST
  'http://127.0.0.1:{port}/hooks/grok-<event>?task_id='"$OPENFORGE_TASK_ID"'&pty_instance_id='"$OPENFORGE_PTY_INSTANCE_ID"'&session_id='"$GROK_SESSION_ID" --data-binary @-`.
  OpenForge injects `OPENFORGE_TASK_ID` / `OPENFORGE_PTY_INSTANCE_ID` only into sessions it
  spawns (via the PTY adapter's `extra_env`, exactly like the Claude adapter), so a user's own
  `grok` run — with no `OPENFORGE_TASK_ID` — runs the guard, sees it empty, and does nothing.
  (We use `"command"` rather than Grok's native `"http"` type precisely because `"http"` posts
  unconditionally and can't guard on env.)
- Installed by the adapter's `prepare()` step (idempotent write), the analog of
  `ensure_codex_hooks_installed`.

**Event → OpenForge lifecycle-kind mapping** (in the new `grok_hooks.rs`, mirroring
`claude_lifecycle_kind_from_event`):

| Grok event | OpenForge kind |
|---|---|
| `SessionStart` | (readiness signal for prompt injection; also BecameBusy) |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse` | BecameBusy |
| `Stop`, `SessionEnd` | Ended |
| `Notification` (permission matcher) | RequestedPermission |

New HTTP routes under `/hooks/grok-*` in `http_server.rs` (mirroring the Claude
`/hooks/{stop,pre-tool-use,…}` routes), or reuse the generic lifecycle ingestion path if it
already accepts a `provider` discriminator — to be confirmed while reading `http_server.rs`.

### D4. Sessions / resume — dedicated DB column

Grok exposes a resumable session ID, so follow the **claude/pi model, not codex**: add a
`grok_session_id TEXT` column.
- Migration in `src-tauri/src/db/migrations.rs`: `ALTER TABLE agent_sessions ADD COLUMN
  grok_session_id TEXT` (mirroring the `pi_session_id` migration at `:829-839`).
- `AgentSessionRow` gains `grok_session_id`; add to `AGENT_SESSION_SELECT_COLUMNS`
  (`db/agents.rs:4-21`); add `set_agent_session_grok_id` + a `set_agent_session_provider_id`
  match arm (`db/agents.rs:106-156`).
- `GrokProvider::provider_session_id` returns `session.grok_session_id`.
- Resume: `grok --resume <grok_session_id>` (or `--continue` when no ID), then inject the new
  prompt via the same PTY mechanism as D2.

### D5. Permission mode
Reuse the existing Claude permission-mode plumbing — Grok's `--permission-mode` values are a
superset of Claude's. The `AddTaskDialog` permission-mode UI is currently gated
`{#if aiProvider === 'claude-code'}` (`AddTaskDialog.svelte:574`); extend the condition to
also show for `grok`. (Note: per Grok docs, in headless mode only `bypassPermissions` takes
effect via the flag; in the interactive TUI the full set applies — which is our case.)

## Change list

Compile-time choke points (adding the enum variant forces these — they guide the work):
`Provider` enum + 8 dispatch matches in `providers/mod.rs`; the `AgentPtyProviderAdapter` trait
in `session.rs`. Everything else is string-keyed and fails *silently* if missed, so must be
updated deliberately.

**Rust (backend)**
1. `providers/grok.rs` — `GrokProvider` (port of `claude_code.rs`; `provider_name()="grok"`,
   `provider_session_id()` → `grok_session_id`).
2. `providers/mod.rs` — `pub mod grok;`, `Grok(GrokProvider)` variant, `from_name("grok")` arm,
   arm in all 8 dispatch matches (+ `mod.rs` test module additions at `:315-588`).
3. `grok_hooks.rs` (new) — `generate`/install `~/.grok/hooks/openforge.json`, guarded command
   hooks, `grok_lifecycle_kind_from_event`, port `ensure_workspace_trusted` analog if needed
   (Grok trust is global-hooks-exempt, so likely a no-op).
4. `pty_manager/session.rs` — `GrokPtyAdapter` (`command_name()="grok"`, `command_args`,
   `extra_env` with `OPENFORGE_TASK_ID`/`OPENFORGE_PTY_INSTANCE_ID`, `prepare()` installs the
   hook, pid file `${task}-pty.pid`) + `spawn_grok_pty` wrapper + prompt-injection hook-in.
5. `pty_manager/commands.rs` — `build_grok_args` (+ tests) producing `--cwd`, `--session-id`/
   `--resume`/`--continue`, `--permission-mode`, `--model`.
6. `runtime_checks.rs` — `check_grok_installed` + `GrokInstallStatus` (port of Claude, minus
   the auth probe unless we add one).
7. `app_invoke/runtime.rs` — register `"check_grok_installed"`.
8. `provider_runtime.rs` — `provider_commands`/`provider_agents` arms.
9. `agent_lifecycle.rs` — `provider_requires_pty_instance` (true), `session_provider_id`,
   event-type mapping.
10. `http_server.rs` — `/hooks/grok-*` routes + event→kind ingestion.
11. `db/migrations.rs` — add `grok_session_id` column migration.
12. `db/agents.rs` — `AgentSessionRow.grok_session_id`, `AGENT_SESSION_SELECT_COLUMNS`,
    `set_agent_session_grok_id`, dispatch arm.

**TypeScript / Svelte (frontend)**
13. `src/lib/agentResumeCommand.ts` — add `'grok'` to the union + `RESUME_COMMANDS`
    (`{ binary: 'grok', flag: '--resume' }`) + `grok_session_id` to `ProviderSessionIdKey`.
14. `src/lib/agentStatusPill.ts` — `case 'grok'` (running text, checkpoint support).
15. `src/lib/ipc.ts` — `checkGrokInstalled`; `electronMigrationContracts.ts` — contract row.
16. `src/lib/settingsConfig.ts` — extend `InstallationStatus` + `loadInstallationStatus`.
17. `src/components/settings/SettingsGeneralCard.svelte` — `PROVIDER_INSTALL_URLS`
    (`https://x.ai/cli`), `providerRecoveryInfo` entry (label "Grok", install/auth guidance),
    install-status row, Props (`grokInstalled`/version).
18. `src/components/settings/SettingsView.svelte` — `grokInstalled`/`grokVersion` state + wiring.
19. `src/components/task-detail/AgentPanel.svelte` — provider branch (`sessionIdKey =
    'grok_session_id'`, `rootTestId`).
20. `src/components/AddTaskDialog.svelte` — include `grok` in permission-mode UI condition;
    command trigger stays `/` (slash), not `$`.

**Docs**
21. `README.md:36`, `CONTRIBUTING.md:11,111`, `docs/roadmap/DEFERRED.md` — add Grok to the
    provider lists.

## Testing strategy (business logic only — no CSS/visual assertions)

- **Rust unit tests** alongside each ported module: `from_name`/`provider_name`/
  `provider_session_id` in `providers/mod.rs`; `build_grok_args` arg-shape assertions
  (session-id vs. resume vs. continue, permission-mode, model); `grok_hooks` — hook JSON
  structure, port substitution, guard present (`OPENFORGE_TASK_ID`), correct
  `/hooks/grok-*` endpoints, `GROK_SESSION_ID` in the curl; `runtime_checks` install-status
  mapping; adapter `command_name`/label assertions in `session.rs`.
- **DB test:** round-trip `grok_session_id` set/get; migration applies on a fresh DB.
- **Vitest:** extend `agentResumeCommand.test.ts` (grok resume command), `agentStatusPill.test.ts`,
  `settingsConfig.test.ts`, `SettingsGeneralCard.test.ts`, `AgentPanel.test.ts`.
- **Manual/spike verification (D2):** launch Grok in a throwaway worktree via the real app,
  confirm prompt injection, a working status pill (SessionStart→Stop), and resume by ID.

## Risks / open questions

1. **Prompt injection reliability (primary risk).** Interactive Grok has no prompt arg; we
   inject via the PTY on SessionStart. Mitigation: the step-0 spike; bounded-retry fallback.
2. **Hook discovery vs. `--settings` parity.** No `--settings` flag → global guarded hook in
   `~/.grok/hooks/`. Confirm the guard reliably makes it inert for the user's own sessions and
   that hook loading needs no per-worktree `/hooks-trust` for the global path (docs say global
   is always trusted).
3. **Install method for detection copy.** Docs show `curl -fsSL https://x.ai/cli/install.sh | bash`
   (and Windows PowerShell). An `@xai-official/grok` npm package was mentioned by third-party
   sources but the bundled docs describe the curl installer only — use the curl script in the
   Settings guidance; treat npm as unverified.
4. **API-key env var name.** Bundled docs (authoritative for 0.2.32) say `XAI_API_KEY`; a web
   source said `GROK_CODE_XAI_API_KEY`. OpenForge doesn't manage auth, so this only affects
   help text — reference `XAI_API_KEY` and browser login.
5. **`http_server.rs` route shape.** Whether to add dedicated `/hooks/grok-*` routes or reuse a
   generic provider-tagged endpoint — decide while reading `http_server.rs` during implementation.

## Implementation order

0. **Spike** D2 (prompt injection + `--session-id`) in a throwaway worktree.
1. Backend enum + `GrokProvider` + adapter + `build_grok_args` (launch works, no status).
2. `grok_hooks.rs` + HTTP routes + lifecycle mapping (status pill works).
3. DB column + resume path.
4. Frontend: detection, settings UI, selection, resume command, status pill, permission-mode.
5. Tests + docs.
6. End-to-end verification in the real app.

## Spike results (2026-07-19, grok 0.2.32)

Ran the Task 0 spike against the real binary in `/tmp/grok-spike`. All questions resolved
**in favor of the design** (and it simplifies a couple of choices):

1. **`--session-id <uuid>` IS honored in interactive mode.** Launched with
   `--session-id 00000000-0000-7000-8000-0000000000ab`; the `SessionStart` hook reported
   exactly that ID, and `grok sessions list` shows the session under that ID (resumable).
   → **Preset the session ID at spawn.** OpenForge knows the resume ID immediately; no need to
   scrape it from a hook. `build_grok_args` uses `--session-id` on fresh start; `GrokProvider::start`
   generates a `uuid::Uuid::now_v7()`.
2. **`SessionStart` fires on launch and carries the session id.** Payload (verified):
   `{"hookEventName":"session_start","sessionId":"…","cwd":"…","workspaceRoot":"…","source":"new"}`,
   with env `GROK_SESSION_ID`/`GROK_WORKSPACE_ROOT` set. → **`SessionStart` is a valid
   prompt-injection trigger.** The `"source"` field also distinguishes `new` vs. resume.
3. **`Stop` fires with `{"reason":"end_turn","sessionId":"…","promptId":"…","transcriptPath":"…"}`.**
   → `Stop` → `Ended` mapping confirmed; rich payload available if needed later.
4. **Global hooks fire for every `grok` invocation** — the spike hook also logged an unrelated
   `grok` session the user had open in `~/repos/openforge`. → **Confirms the `OPENFORGE_TASK_ID`
   guard is necessary** in the production hook so it stays inert for the user's own sessions.

**Injection timing:** `SessionStart` fires within the first moment of launch; the TUI input is
ready ~immediately after. Task 8 writes the prompt on `SessionStart` with a small bounded retry
to absorb any sub-second readiness gap — finalized against the app's real PTY.

**Net effect on the plan:** no structural change. Task 2/5's preset-session-id path is now the
confirmed primary (not a fallback); Task 8 injects on `SessionStart`.

## Revision (2026-07-19): grok 0.2.103 adds a positional [PROMPT]

The `grok` CLI auto-updates by default, and the installed binary moved from 0.2.32 (the
version this design was written and spiked against) to 0.2.103 during day-to-day use. That
newer version **gained a positional prompt argument**:

```
Usage: grok [OPTIONS] [PROMPT] [COMMAND]
Arguments:
  [PROMPT]  Initial prompt for the interactive session, e.g. `grok "fix the bug"`
```

This invalidates the D2 launch model above, which was built on the (then-true) premise that
"Grok's interactive TUI has no positional prompt argument." In practice, launching bare
`grok` on 0.2.103 lands on a welcome screen and never starts a session — so `SessionStart`
never fires, meaning **neither the prompt nor any lifecycle status update was ever
delivered** (the status pill was silently broken too, since it depends on the same hook).

**Fix:** pass the prompt as the trailing positional argument, exactly like the other
providers (`claude`, `codex`, `opencode`, `pi`) already do — `grok [OPTIONS] [PROMPT]`. The
entire SessionStart-injection subsystem this design specified is removed as a result:

- `build_grok_args` regains a `prompt: &str` parameter and appends it as the last element
  when non-empty, mirroring `build_claude_args`.
- The PTY-write injection path (`PtyManager::write_pty_by_instance`, the pending-prompt
  store `set_pending_prompt`/`take_pending_prompt`, and `http_server.rs`'s
  `maybe_inject_grok_prompt` + `GROK_PROMPT_INJECTION_DELAY`) is deleted outright — there is
  no longer anything to inject once the CLI accepts the prompt directly.
- The `SessionStart` hook keeps its original job (lifecycle status + session-id capture);
  it just no longer doubles as a prompt-delivery signal.

**Caveat:** this fix requires a `grok` CLI recent enough to have the `[PROMPT]` positional —
it did not exist in the 0.2.32 build this design was originally validated against. Since
`grok` auto-updates by default, users who installed before this positional shipped will pick
it up automatically; anyone pinned to an older build (auto-update disabled) will still hit
the original bug until they upgrade.
