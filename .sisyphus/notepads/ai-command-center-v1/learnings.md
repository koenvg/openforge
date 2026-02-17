# Learnings & Conventions

This file accumulates knowledge about the codebase patterns, naming conventions, and best practices discovered during implementation.

---

## Task 1.1: Tauri 2.0 + Svelte + TypeScript Scaffold

### Key Learnings

1. **Tauri 2.0 Configuration**
   - `identifier` field must be at top level of `tauri.conf.json`, not in bundle section
   - `frontendDist` path is validated at compile time via `tauri::generate_context!()` macro
   - Icon files must exist and be valid PNG/ICO/ICNS files (created minimal 1x1 PNGs for scaffold)

2. **Rust Version Compatibility**
   - Tauri 2.10.2 requires Rust 1.88.0+ due to `time` crate dependency
   - Updated from Rust 1.86.0 to 1.93.1 via `rustup update`
   - Removed `shell-open` feature from Tauri 2.0 (doesn't exist in this version)

3. **Svelte + TypeScript Setup**
   - Must install `svelte-preprocess` as dev dependency for TypeScript support in `.svelte` files
   - Vite config must explicitly pass `preprocess: sveltePreprocess()` to svelte plugin
   - `tsconfig.json` requires `verbatimModuleSyntax: true` when using TypeScript in Svelte

4. **Project Structure**
   - Frontend: `src/` (Svelte components, TypeScript)
   - Backend: `src-tauri/` (Rust, Cargo.toml)
   - Build output: `dist/` (Vite builds here, Tauri references it)
   - Config: `vite.config.ts`, `tsconfig.json`, `src-tauri/tauri.conf.json`

5. **Build Process**
   - Frontend: `npm run build` → Vite bundles to `dist/`
   - Backend: `cargo check` validates Rust code
   - Dev: `npm run tauri:dev` runs both frontend dev server and Tauri app

### Conventions Established

- Package name: `ai-command-center` (kebab-case)
- Identifier: `com.opencode.ai-command-center` (reverse domain notation)
- Frontend entry: `src/main.ts` → mounts `App.svelte` to `#app` div
- Tauri entry: `src-tauri/src/main.rs` → minimal boilerplate with `tauri::generate_context!()`


## Task 1.2: SQLite Database Setup (2026-02-17)

### Database Module Implementation
- Created `src-tauri/src/db.rs` with complete schema for all 6 tables
- Used `rusqlite` v0.32 with "bundled" feature (includes SQLite statically)
- Database stored in Tauri app data directory via `app.path().app_data_dir()`
- Thread-safe access via `Arc<Mutex<Connection>>` wrapper

### Schema Details
- All tables use `CREATE TABLE IF NOT EXISTS` for idempotent migrations
- Foreign keys enabled via `PRAGMA foreign_keys = ON`
- Boolean fields stored as INTEGER (0/1) per SQLite convention
- Timestamps stored as INTEGER (Unix epoch)
- Default config values inserted with `INSERT OR IGNORE` to prevent duplicates

### Tauri Integration Patterns
- Database initialized in `.setup()` hook before app runs
- Database stored in Tauri managed state via `app.manage(Mutex::new(database))`
- This allows access from Tauri commands later via `State<Mutex<Database>>`

### Testing
- Added unit tests for database initialization and config operations
- Tests use temp directory and clean up after themselves
- All tests pass: `cargo test` shows 2 passed

### Dependencies Added
- `rusqlite = { version = "0.32", features = ["bundled"] }`
- "bundled" feature includes SQLite library (no system dependency needed)

### Database Location
- macOS: `~/Library/Application Support/com.opencode.ai-command-center/ai_command_center.db`
- Linux: `~/.local/share/ai-command-center/ai_command_center.db`
- Windows: `%APPDATA%\com.opencode.ai-command-center\ai_command_center.db`

### Public API Exposed
- `Database::new(db_path)` - Initialize database with migrations
- `Database::connection()` - Get Arc<Mutex<Connection>> for queries
- `Database::get_config(key)` - Get config value
- `Database::set_config(key, value)` - Set config value

### Next Steps
- CRUD operations for tickets, sessions, logs, PRs will be added in later tasks
- Tauri commands will access database via managed state
- JIRA sync service (Task 2.2) will use this database
- GitHub poller (Task 3.2) will use this database

## Task 1.3: OpenCode Process Manager (2026-02-17)

### Process Management Implementation
- Created `src-tauri/src/opencode_manager.rs` to spawn and monitor `opencode web` server
- Uses `tokio::process::Command` for async process spawning with `kill_on_drop(true)`
- Stores child process in `Arc<Mutex<Option<Child>>>` for thread-safe access
- Process spawned with: `opencode web --port 4096 --hostname 127.0.0.1`

### Health Check Pattern
- Polls `http://localhost:4096/health` every 500ms until server responds
- Uses `reqwest::Client` with 5-second timeout per request
- Overall health check timeout: 30 seconds (configurable via const)
- Blocks app startup until server is healthy (ensures API is ready before UI shows)

### Dependencies Added
- `reqwest = { version = "0.12", features = ["json"] }` - HTTP client for health checks
- `which = "6.0"` - Resolve `opencode` command in PATH
- `nix = { version = "0.29", features = ["signal", "process"] }` - Unix signal handling for graceful shutdown

### Tauri Integration
- OpenCodeManager initialized in `.setup()` hook using `tauri::async_runtime::block_on()`
- Stored in managed state via `app.manage(opencode_manager)` for access from commands
- Main function changed to `#[tokio::main] async fn main()` to support async setup

### Error Handling
- Custom `OpenCodeError` enum with descriptive error messages
- Checks if `opencode` CLI exists before spawning (returns helpful install message if missing)
- Graceful shutdown with SIGTERM first, SIGKILL after 5-second timeout (Unix only)

### Process Lifecycle
- Spawned on app startup in setup hook
- Health check blocks until server ready
- Process handle stored for cleanup
- `kill_on_drop(true)` ensures cleanup even if shutdown() not called explicitly

### Platform Considerations
- Unix: Uses `nix::sys::signal::kill()` for graceful SIGTERM shutdown
- Windows: Falls back to immediate kill (no SIGTERM support)
- Process stdout/stderr piped (can be logged in future tasks)

### Testing
- Added test to verify `opencode` command exists in PATH
- Full integration test requires running app (manual verification)

### Warnings (Expected)
- `shutdown()` method unused (will be called from app exit handler in future task)
- `child` field unused warning (accessed via Arc<Mutex> in shutdown)
- `SHUTDOWN_TIMEOUT` unused (used in Unix-specific code path)

### Next Steps
- Task 1.4 will create REST API client to communicate with this server
- Task 1.5 will implement Tauri commands that use both manager and API client
- Future task: Add proper logging for process stdout/stderr
- Future task: Implement app exit handler to call shutdown() explicitly


## Task 1.4: OpenCode REST API Client (2026-02-17)

### Implementation Details
- Created `src-tauri/src/opencode_client.rs` with complete type-safe REST API client
- Used `reqwest` v0.12 with `json` and `stream` features for HTTP client
- Added `tokio-stream` v0.1 for Stream trait support
- Added `bytes` v1.0 for SSE byte stream handling

### API Client Structure
- **OpenCodeClient** struct with connection pooling via reusable `reqwest::Client`
- Base URL configurable (default: `http://localhost:4096`)
- All methods are async and return `Result<T, OpenCodeError>`

### Implemented Functions
1. **create_session(title: String) -> Result<String>**
   - POST /sessions with JSON body `{ title: string }`
   - Returns session ID from response
   - Error handling for network, API, and parse errors

2. **send_prompt(session_id: &str, text: String) -> Result<serde_json::Value>**
   - POST /sessions/{id}/prompt with JSON body `{ parts: [{ type: "text", text: string }] }`
   - Returns raw JSON response (structure varies by OpenCode version)
   - Constructs Part struct with type="text"

3. **subscribe_events() -> Result<EventStream>**
   - GET /events for server-sent events
   - Returns EventStream wrapper with `into_stream()` method
   - Stream yields `Result<bytes::Bytes, reqwest::Error>`

4. **health() -> Result<HealthResponse>**
   - GET /health for server health check
   - Returns `{ healthy: bool, version: Option<String> }`

### Type System
- **Request types**: CreateSessionRequest, SendPromptRequest, Part
- **Response types**: CreateSessionResponse, HealthResponse
- **Error type**: OpenCodeError enum with NetworkError, ApiError, ParseError variants
- All types use serde for JSON serialization/deserialization
- CreateSessionResponse uses `#[serde(flatten)]` to capture extra fields

### Error Handling Pattern
- Custom OpenCodeError enum implements Display and std::error::Error
- Network errors: Connection failures, timeouts
- API errors: Non-2xx status codes with status and message
- Parse errors: JSON deserialization failures
- All API methods check response.status().is_success() before parsing

### Testing
- 5 unit tests covering:
  - Client creation with default and custom URLs
  - Request serialization (CreateSessionRequest, SendPromptRequest)
  - Error display formatting
- All tests pass: `cargo test opencode_client`

### Dependencies Added
- `reqwest = { version = "0.12", features = ["json", "stream"] }`
- `tokio-stream = "0.1"`
- `bytes = "1.0"`

### Integration Notes
- Module imported in main.rs but not yet used (Task 1.5 will integrate)
- Client is Clone-able for sharing across Tauri commands
- EventStream provides low-level byte stream access (SSE parsing to be added in Task 1.5)
- Base URL hardcoded to localhost:4096 (matches OpenCodeManager default port)

### API Endpoint Reference (from SDK)
- POST /sessions — Create session, returns { id: string, ... }
- POST /sessions/{id}/prompt — Send prompt, body: { parts: [{ type: "text", text: string }] }
- GET /events — Server-sent events stream
- GET /health — Health check, returns { healthy: bool, version: string }

### Next Steps
- Task 1.5 will create Tauri commands that use this client
- Task 1.5 will parse SSE events from EventStream
- Task 4.1 orchestrator will use this client for agent control

## Task 1.5: Tauri Commands for OpenCode Integration (2026-02-17)

### Implementation Overview
- Added 3 Tauri commands to expose OpenCode functionality to frontend
- Commands access managed state (OpenCodeManager, OpenCodeClient)
- All commands are async and return Result<T, String> for error handling

### Commands Implemented

1. **get_opencode_status() -> Result<OpenCodeStatus, String>**
   - Accesses both OpenCodeManager (for API URL) and OpenCodeClient (for health check)
   - Returns: `{ api_url: string, healthy: bool, version: Option<string> }`
   - Calls client.health() to verify server is responsive

2. **create_session(title: String) -> Result<String, String>**
   - Thin wrapper over OpenCodeClient::create_session()
   - Returns session ID on success
   - Error messages formatted with context

3. **send_prompt(session_id: String, text: String) -> Result<serde_json::Value, String>**
   - Thin wrapper over OpenCodeClient::send_prompt()
   - Returns raw JSON response (structure varies by OpenCode version)
   - Frontend will parse response based on needs

### Tauri Command Patterns

**Command Signature:**
```rust
#[tauri::command]
async fn command_name(
    state: State<'_, T>,
    param: String,
) -> Result<ReturnType, String>
```

**State Access:**
- `State<'_, OpenCodeManager>` - Immutable managed state (no Mutex needed)
- `State<'_, OpenCodeClient>` - Immutable managed state (Clone-able)
- `State<'_, Mutex<Database>>` - Mutable managed state (requires Mutex)

**Error Handling:**
- Commands return `Result<T, String>` (String is error message for frontend)
- Use `.map_err(|e| format!("Context: {}", e))` to convert errors
- OpenCodeError implements Display, so `.to_string()` works

**Registration:**
```rust
.invoke_handler(tauri::generate_handler![
    command1,
    command2,
    command3
])
```

### State Management
- OpenCodeClient created once in setup hook with manager's API URL
- Both manager and client stored in managed state via `app.manage()`
- Client is Clone-able, so State<OpenCodeClient> works without Mutex
- Manager is immutable after creation, so State<OpenCodeManager> works without Mutex

### Response Types
- Created OpenCodeStatus struct with serde::Serialize
- Struct fields match frontend expectations (camelCase via serde default)
- Used Option<String> for optional version field

### Frontend Integration (Future Task 5.1)
Frontend will call commands via:
```typescript
import { invoke } from '@tauri-apps/api/core';

// Get status
const status = await invoke<OpenCodeStatus>('get_opencode_status');

// Create session
const sessionId = await invoke<string>('create_session', { title: 'My Session' });

// Send prompt
const response = await invoke<any>('send_prompt', { 
  sessionId: 'ses_123', 
  text: 'Hello!' 
});
```

### Verification
- `cargo check` passes with no errors (only expected warnings for unused methods)
- `cargo build` succeeds
- Commands properly registered in invoke_handler
- All three commands use async/await correctly
- Error handling converts OpenCodeError to String for frontend

### Key Learnings
1. **Tauri commands must be async** when accessing async state or calling async methods
2. **State<T> vs State<Mutex<T>>**: Use Mutex only for mutable state
3. **Error conversion**: Frontend expects String errors, so use `.map_err()` to format
4. **Command registration**: Use `tauri::generate_handler![]` macro with command names
5. **OpenCodeClient creation**: Use `with_base_url()` to match manager's URL

### Dependencies
- No new dependencies added (all required deps already present from Tasks 1.3, 1.4)
- Uses: tauri::State, serde::Serialize, opencode_client, opencode_manager

### Next Steps
- Phase 2: JIRA integration will follow similar command pattern
- Phase 3: GitHub integration will follow similar command pattern
- Phase 4: Orchestrator will use OpenCodeClient directly (not via commands)
- Phase 5: Frontend will implement UI to call these commands


## Task 2.1: JIRA Cloud REST API Client (2026-02-17)

### Implementation Overview
- Created `src-tauri/src/jira_client.rs` with complete type-safe JIRA Cloud REST API v3 client
- Follows same pattern as OpenCodeClient (reusable reqwest::Client, async methods, Result types)
- Implements HTTP Basic Auth with base64-encoded `email:api_token`

### API Client Structure
- **JiraClient** struct with connection pooling via reusable `reqwest::Client`
- Base URL parameterized (caller provides `https://your-domain.atlassian.net`)
- All methods are async and return `Result<T, JiraError>`
- Client is Clone-able for sharing across Tauri commands

### Implemented Functions
1. **search_issues(base_url, email, api_token, jql) -> Result<Vec<JiraIssue>>**
   - GET `/rest/api/3/search?jql={jql}`
   - Returns vector of issues matching JQL query
   - Example JQL: `"project = PROJ AND status = 'In Progress'"`

2. **get_ticket_details(base_url, email, api_token, key) -> Result<JiraIssue>**
   - GET `/rest/api/3/issue/{key}`
   - Returns full issue details for specific key (e.g., "PROJ-123")

3. **transition_ticket(base_url, email, api_token, key, transition_id) -> Result<()>**
   - POST `/rest/api/3/issue/{key}/transitions`
   - Body: `{ transition: { id: "31" } }`
   - Changes issue status (e.g., "To Do" → "In Progress")

4. **get_available_transitions(base_url, email, api_token, key) -> Result<Vec<JiraTransition>>**
   - GET `/rest/api/3/issue/{key}/transitions`
   - Returns available transitions with IDs and names
   - Use this to get transition_id for transition_ticket()

### Type System
- **Request types**: TransitionRequest, TransitionId
- **Response types**: SearchResponse, JiraIssue, JiraFields, JiraStatus, JiraUser, JiraPriority, JiraTransition, TransitionsResponse
- **Error type**: JiraError enum with NetworkError, ApiError, ParseError variants
- All types use serde for JSON serialization/deserialization
- Used `#[serde(flatten)]` to capture extra fields from API responses
- Used `#[serde(default)]` for optional fields (assignee, priority, description)
- Used `#[serde(rename = "displayName")]` for camelCase API fields

### Authentication Pattern
- HTTP Basic Auth: `Authorization: Basic {base64(email:api_token)}`
- Helper function `create_basic_auth_header(email, api_token)` encodes credentials
- Uses `base64` crate v0.22 with STANDARD engine
- Auth header added to every request via `.header("Authorization", auth_header)`

### Error Handling Pattern
- Custom JiraError enum implements Display and std::error::Error
- Network errors: Connection failures, timeouts
- API errors: Non-2xx status codes with status and message
- Parse errors: JSON deserialization failures
- All API methods check `response.status().is_success()` before parsing

### Testing
- 5 unit tests covering:
  - Client creation
  - Basic auth header generation
  - Base64 encoding
  - Request serialization (TransitionRequest)
  - Error display formatting
- All tests pass: `cargo test` shows 13 passed (5 new + 8 existing)

### Dependencies Added
- `base64 = "0.22"` - Base64 encoding for HTTP Basic Auth

### Key Learnings
1. **HTTP Basic Auth**: Format is `Authorization: Basic {base64(email:api_token)}`
2. **JIRA API v3**: Uses `/rest/api/3/` prefix for all endpoints
3. **JQL (JIRA Query Language)**: Passed as query parameter `?jql={jql}`
4. **Transition IDs**: Must call `get_available_transitions()` first to get valid IDs
5. **Parameterized base URL**: No default URL (caller must provide domain)
6. **Serde patterns**: Use `#[serde(flatten)]` for extra fields, `#[serde(default)]` for optional fields
7. **Clone-able client**: Allows sharing across async tasks and Tauri commands

### Integration Notes
- Module imported in main.rs but not yet used (Task 2.3 will create Tauri commands)
- Client will be used by JIRA sync service (Task 2.2) for background polling
- Client will be used by Tauri commands (Task 2.3) for frontend integration
- Base URL, email, and API token will come from database config (set by user in UI)

### JIRA API Endpoint Reference
- GET `/rest/api/3/search?jql={jql}` — Search issues, returns `{ issues: [{ key, fields }] }`
- GET `/rest/api/3/issue/{key}` — Get issue details, returns `{ key, fields, ... }`
- POST `/rest/api/3/issue/{key}/transitions` — Transition issue, body: `{ transition: { id } }`
- GET `/rest/api/3/issue/{key}/transitions` — Get available transitions, returns `{ transitions: [{ id, name }] }`

### Next Steps
- Task 2.2: Background polling service that uses this client to sync tickets every 60s
- Task 2.3: Tauri commands that expose JIRA functions to frontend
- Task 2.4: Frontend UI for JIRA ticket management


## Task 2.2: JIRA Sync Background Service (2026-02-17)

### Implementation Overview
- Created `src-tauri/src/jira_sync.rs` with background Tokio task for polling JIRA
- Spawned in main.rs setup hook using `tauri::async_runtime::spawn()`
- Polls JIRA every N seconds (configurable via `jira_poll_interval` config)
- Builds JQL query based on config filters, fetches tickets, upserts to database
- Emits `jira-sync-complete` Tauri event to notify frontend after each sync

### Background Task Pattern
- Function signature: `pub async fn start_jira_sync(app: AppHandle)`
- Spawned with: `tauri::async_runtime::spawn(async move { start_jira_sync(app_handle).await; })`
- Runs indefinitely in loop: read config → build JQL → fetch → upsert → emit event → sleep
- Access managed state via `app.state::<Mutex<Database>>()`
- Emit events via `app.emit("event-name", payload)`

### JQL Query Builder
- `build_jql_query(config)` combines multiple filters with AND:
  - `filter_assigned_to_me=true` → `assignee = currentUser()`
  - `jira_board_id` set → `project = {board_id}`
  - `exclude_done_tickets=true` → `status != Done`
  - `custom_jql` → appended as-is
- Always appends `ORDER BY updated DESC` for consistent ordering
- Empty filters → returns just `ORDER BY updated DESC` (all tickets)

### JIRA Status Mapping
- Maps JIRA status names to cockpit status enum:
  - "To Do" → "todo"
  - "In Progress" → "in_progress"
  - "In Review" | "Code Review" → "in_review"
  - "Testing" | "QA" → "testing"
  - "Done" | "Closed" → "done"
  - Unknown → "todo" (default fallback)
- Function: `map_jira_status_to_cockpit(jira_status: &str) -> &'static str`

### Database Integration
- Added `Database::upsert_ticket()` method to db.rs
- Uses `INSERT OR REPLACE` for idempotent upserts
- 8 parameters: id, title, description, status, jira_status, assignee, created_at, updated_at
- Timestamps stored as Unix epoch (i64)
- Added `jira_base_url` to default config (13 total config keys now)

### Config Keys Used
```
jira_api_token      - JIRA API token for authentication
jira_base_url       - JIRA instance URL (e.g., https://example.atlassian.net)
jira_board_id       - Project key for filtering (e.g., "PROJ")
jira_username       - Email for HTTP Basic Auth
filter_assigned_to_me - Boolean (true/false string)
exclude_done_tickets  - Boolean (true/false string)
custom_jql          - Additional JQL to append
jira_poll_interval  - Seconds between polls (default: 60)
```

### Error Handling Strategy
- Logs errors to stderr with `eprintln!` (no crash)
- Config read errors → sleep 60s and retry
- Missing required config → skip sync, sleep, retry
- JIRA API errors → log and retry next cycle
- Individual ticket upsert errors → log and continue with next ticket
- Event emit errors → log but don't stop sync
- Graceful degradation: sync loop never crashes

### Tauri Event Pattern
- Event name: `jira-sync-complete`
- Payload: `()` (empty, frontend just needs notification)
- Emitted after successful sync (even if some tickets failed)
- Frontend listens with: `await listen('jira-sync-complete', () => { refreshKanban(); })`

### Testing
- 3 unit tests covering:
  - JQL query builder with all filters enabled
  - JQL query builder with no filters
  - JIRA status to cockpit status mapping
- All tests pass: `cargo test` shows 16 passed (3 new + 13 existing)

### Key Learnings
1. **Background tasks in Tauri**: Use `tauri::async_runtime::spawn()` in setup hook
2. **AppHandle for state access**: Clone app handle before moving into async block
3. **Infinite loop pattern**: `loop { ... sleep(Duration::from_secs(n)).await; }`
4. **Config as strings**: Boolean config stored as "true"/"false" strings, parse with `== "true"`
5. **Graceful error handling**: Log and continue, never crash the sync loop
6. **Tauri events**: Use `app.emit(event_name, payload)` to notify frontend
7. **Database locking**: Lock database only for duration of operation, release ASAP
8. **JQL construction**: Use Vec<String> and join with " AND " for clean query building

### Integration Notes
- Module imported in main.rs: `mod jira_sync;`
- Task spawned in setup hook after database and OpenCode initialization
- Requires JiraClient (created in task), Database (managed state), AppHandle (for events)
- Sync starts immediately on app launch (first poll happens after reading config)
- No Tauri commands needed (fully autonomous background task)

### Dependencies
- No new dependencies added (all required deps already present)
- Uses: tokio::time::{sleep, Duration}, tauri::{AppHandle, Emitter, Manager}

### Next Steps
- Task 2.3: Tauri commands for manual JIRA operations (fetch single ticket, transition status)
- Task 2.4: Frontend UI to display synced tickets in Kanban board
- Task 2.5: Settings UI to configure JIRA credentials and filters
- Future: Add manual sync trigger command (don't wait for next poll)
- Future: Add sync status indicator (last sync time, error state)



## Task 3.1: GitHub REST API Client (2026-02-17)

### GitHub Client Implementation
- Created `src-tauri/src/github_client.rs` following established JIRA client pattern
- Implements type-safe wrappers for GitHub REST API v3
- Uses `reqwest::Client` for HTTP requests with reusable client instance
- Module imported in main.rs: `mod github_client;`

### Authentication Pattern
- GitHub uses Personal Access Token (PAT) authentication
- Header format: `Authorization: token {personal_access_token}`
- Different from JIRA's Basic Auth (base64-encoded email:token)
- No helper function needed (simpler than JIRA's base64 encoding)

### Required Headers
- `Authorization: token {pat}` - Authentication
- `User-Agent: ai-command-center` - Required by GitHub API (returns 403 without it)

### API Endpoints Implemented
1. **Get PR Details**: `GET /repos/{owner}/{repo}/pulls/{number}`
   - Returns: `PullRequest` struct with number, title, state, html_url, user
   
2. **Get PR Comments**: Merges two endpoints into unified response
   - Review comments: `GET /repos/{owner}/{repo}/pulls/{number}/comments` (inline code comments)
   - Issue comments: `GET /repos/{owner}/{repo}/issues/{number}/comments` (general comments)
   - Returns: `Vec<PrComment>` with `comment_type` field to distinguish types
   
3. **Post PR Comment**: `POST /repos/{owner}/{repo}/issues/{number}/comments`
   - Posts general comment (not inline review comment)
   - Request body: `{ "body": "comment text" }`
   
4. **Get PR Status**: Reuses `get_pr_details` and extracts `state` field
   - Returns: String ("open", "closed", "merged")

### Type System Design
- **PullRequest**: Core PR metadata (number, title, state, html_url, user)
- **PrComment**: Unified comment type with optional fields for review comments
  - `path: Option<String>` - File path (only for review comments)
  - `line: Option<i32>` - Line number (only for review comments)
  - `comment_type: String` - "review_comment" or "issue_comment"
- **GitHubUser**: Simple user representation (login + extra fields)
- **ReviewComment** (internal): Raw review comment from API
- **IssueComment** (internal): Raw issue comment from API
- All structs use `#[serde(flatten)]` for extra fields (forward compatibility)

### Error Handling
- **GitHubError** enum with three variants:
  - `NetworkError(String)` - Connection failures, timeouts
  - `ApiError { status: u16, message: String }` - Non-2xx responses
  - `ParseError(String)` - JSON deserialization failures
- Implements `std::error::Error` and `Display` traits
- Same pattern as JiraError (consistency across clients)

### Comment Merging Strategy
- Fetches both review and issue comments in parallel (two API calls)
- Converts internal types to unified `PrComment` type
- Tags review comments with `comment_type: "review_comment"`
- Tags issue comments with `comment_type: "issue_comment"`
- Review comments have `path` and `line` fields populated
- Issue comments have `path` and `line` as `None`
- Returns single `Vec<PrComment>` for easy frontend consumption

### Testing
- 6 unit tests covering:
  - Client creation and default trait
  - Comment request serialization
  - Error display formatting
  - PR comment serialization with all fields
  - Pull request deserialization with extra fields
- All tests pass: `cargo test` shows 22 passed (6 new + 16 existing)

### Key Learnings
1. **GitHub API quirks**: Requires User-Agent header (403 without it)
2. **Comment types**: PRs have two comment types (review vs issue), must merge manually
3. **Simpler auth**: Token-based auth is simpler than JIRA's Basic Auth (no base64 encoding)
4. **Unified types**: Better UX to merge similar data types into one with discriminator field
5. **Optional fields**: Use `Option<T>` for fields that only exist in some variants
6. **Reusable patterns**: Following JIRA client pattern made implementation straightforward
7. **Error consistency**: Using same error pattern across clients improves maintainability

### API Design Decisions
- **Why merge comments?**: Frontend doesn't need to know about GitHub's internal distinction
- **Why `comment_type` field?**: Allows frontend to filter/display differently if needed
- **Why reuse `get_pr_details` in `get_pr_status`?**: Avoids code duplication, single source of truth
- **Why not implement inline review comments?**: Task scope limited to general comments (POST to issues endpoint)

### Dependencies
- No new dependencies added (all required deps already present from JIRA client)
- Uses: reqwest, serde, serde_json, std::error::Error, std::fmt

### Integration Notes
- Module imported in main.rs but not yet used in Tauri commands
- Ready for Task 3.3 (Tauri commands for GitHub operations)
- Client can be instantiated with `GitHubClient::new()` or `GitHubClient::default()`
- All methods are async and return `Result<T, GitHubError>`

### Next Steps
- Task 3.2: Background polling for GitHub PR status changes
- Task 3.3: Tauri commands to expose GitHub client to frontend
- Task 3.4: Frontend UI to display PR comments and post new comments
- Future: Add support for posting inline review comments (requires different endpoint)
- Future: Add pagination support for large comment threads
- Future: Add rate limit handling (GitHub API has rate limits)

