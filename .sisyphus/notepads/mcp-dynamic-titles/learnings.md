# Learnings: MCP Dynamic Titles

## T-512: TLDR Summary Subtitle on Kanban Cards

### What was done
- Added title fallback chain in `TaskCard.svelte`: `task.title || (task.prompt?.split('\n')[0]) || task.id`
- Added summary subtitle below title using `{#if task.summary}` block
- Summary uses daisyUI classes: `text-xs text-base-content/50 truncate`
- Updated test `baseTask` to include `prompt: null` and `summary: null` fields (required by Task interface)

### Key patterns
- Title fallback: use `task.title || (task.prompt?.split('\n')[0]) || task.id` — the optional chaining `?.` handles `prompt: null` safely
- Conditional subtitle: `{#if task.summary}` renders nothing when null — no empty space
- The `firstLine()` helper already existed in the component; the fallback can reuse it inline
- When `task.title` is an empty string `''`, it is falsy in JS, so the fallback chain works correctly

### Test patterns
- Mock tasks must include all fields from the `Task` interface — when types.ts is updated, test fixtures need updating too
- TDD order: update `baseTask` + add new tests → confirm failures → implement → confirm green

## T-512: update_task and get_task_info MCP tools + GET /task/:id endpoint

### What was done
- Added `update_task` and `get_task_info` tools to `src-tauri/src/mcp-server/index.js`
- Added `GetTaskInfoResponse` struct, `get_task_info_handler`, and `/task/:id` GET route to `http_server.rs`

### Key patterns
- `db.get_task()` is the existing function (not `get_task_by_id`) — use it directly in `get_task_info_handler`
- axum path param extraction: `Path(id): Path<String>` as first extractor, `use axum::extract::Path;`
- Add `get` to routing import: `use axum::routing::{post, get};`
- `GetTaskInfoResponse` serializes `Option<String>` fields as JSON `null` when `None`
- Route chained as `.route("/task/:id", get(get_task_info_handler))`
- MCP tool graceful error: `catch (e) { return { content: [{ type: 'text', text: \`Error: ${message}. Is Open Forge running?\` }] }; }`
- `tools/list` JSON-RPC confirms 3 tools with correct inputSchema (zod → JSON Schema auto-conversion)
- 56 http_server tests pass; 5 new `GetTaskInfoResponse` serialization tests added

## T-512: Display prompt and summary in TaskInfoPanel + title fallback in TaskDetailView

### What was done
- `TaskInfoPanel.svelte`: Changed INITIAL_PROMPT section from `{task.title}` to `{task.prompt ?? ''}` (semantic fix — label already existed)
- `TaskInfoPanel.svelte`: Added SUMMARY section with `{#if task.summary}` / `"No summary yet"` fallback in `text-xs text-base-content/50`
- `TaskDetailView.svelte`: Added `let displayTitle = $derived(task.title || (task.prompt ? task.prompt.split('\n')[0] : '') || task.id)` and used it in the header h1

### Key patterns
- INITIAL_PROMPT label existed but showed `task.title` — semantic intent was already there, just the data source was wrong
- `task.prompt` is `string | null` — use `task.prompt ?? ''` in template to avoid Svelte rendering null
- `$derived` keeps fallback chain logic out of the template, making it testable via `getByRole('heading', { level: 1 }).textContent`
- Testing-library `getByLabelText('Initial Prompt')` finds elements with `aria-label="Initial Prompt"` directly on them (not just form labels)
- Avoid newline `\n` in `getByText` test strings — testing-library's default normalizer collapses whitespace; use single-line strings for fixture prompts
- Read-only assertion: `promptSection?.querySelector('input')` and `querySelector('textarea')` returning null confirms no editable elements

## T-512: MCP server auto-config installer

### What was done
- Created `src-tauri/src/mcp_installer.rs` with 3 public functions:
  - `install_mcp_server()` — writes `index.js`/`package.json` to `~/.config/openforge/mcp-server/`, runs `npm install --omit=dev`
  - `configure_opencode_mcp(token, port)` — merges openforge entry into `~/.config/opencode/config.json`
  - `configure_claude_mcp(token, port)` — merges openforge entry into `~/.claude.json`
- Updated `main.rs`: added `mod mcp_installer;`, replaced plugin_installer call with `install_mcp_server()`, spawned async task after HTTP server to call `configure_*` after 500ms

### Key patterns
- `merge_mcp_config(existing: Option<Value>, token, port, install_path) -> Value` — extracts merge logic for testability
- `matches!(config.get("mcpServers"), Some(Value::Object(_)))` — idiomatic check before inserting key
- `write_mcp_server_files(dir: &PathBuf)` — private inner fn allows testing file writes with a temp dir without npm
- `std::env::temp_dir().join(format!("test_name_{}", std::process::id()))` — temp dir pattern without `tempfile` dep
- npm install failure is non-fatal: log error but return `Ok(())` so startup continues
- HTTP_TOKEN is set inside `start_http_server` async — use `tokio::time::sleep(500ms)` then `HTTP_TOKEN.get()` in a spawned task
- `dirs::home_dir()` for `~/.claude.json`, `dirs::config_dir()` for `~/.config/*`
- `serde_json::to_string_pretty` for human-readable output
- `include_str!("mcp-server/index.js")` — path relative to the `.rs` file, not to `src-tauri/`
