# Anthropic cloud API key + cloud-powered roadmap Refine

Task: AVIV-40

## Summary

Introduce a global-settings **Anthropic API key** ("cloud API key") as a new,
reusable capability, and make it the first consumer: the roadmap plugin's
**Refine** action calls the Anthropic Messages API with Claude Opus 4.8 directly
instead of shelling out to the OpenForge CLI providers (codex / claude-code /
opencode).

The key is a direct Anthropic API key (`sk-ant-…`); OpenForge calls
`api.anthropic.com` directly. There is no hosted proxy.

## Goals

- Store an Anthropic API key securely in global settings (OS keychain).
- Roadmap Refine uses the Anthropic API (Claude Opus 4.8) when the key is set.
- When no key is set, the Refine buttons are disabled with a tooltip pointing the
  user to Settings; manual "Skip AI" ticket creation still works.
- Keep the key private to the Rust sidecar — never expose it to plugins; plugins
  only learn a boolean "is a key present".

## Non-goals

- No model picker; Claude Opus 4.8 is hardcoded as the "high-Q model".
- No hosted OpenForge cloud proxy or multi-provider abstraction.
- No CLI fallback for Refine (the CLI shell-out path is removed).
- No changes to the project-level AI provider used for agent work — only the
  roadmap Refine action changes.

## Decisions made

- The "cloud API key" is a direct Anthropic API key. Calls go to
  `https://api.anthropic.com/v1/messages`.
- The key is stored as a keychain secret via the existing `secure_store` path,
  by adding `anthropic_api_key` to the manifest `secretAccounts`.
- Refine requires the key. With no key, the Refine and "Refine with feedback"
  buttons are disabled with a tooltip; "Skip AI" and manual create stay enabled.
- The key input lives in the existing `SettingsCredentialsCard` (a new "Anthropic"
  section), consistent with the GitHub token.
- Model is hardcoded to `claude-opus-4-8`, `max_tokens: 4096`, no extended
  thinking (ticket refinement is a light task — faster and cheaper without it).
- The now-dead CLI shell-out code in `roadmap_ai.rs` is removed; the prompt
  builder, response parser, and shared types are reused.

## Architecture

### 1. Settings — store the Anthropic API key

- **Manifest:** add `"anthropic_api_key"` to
  `dataIdentity.keychain.secretAccounts` in `openforge-data-identity.json`. The
  Rust `data_identity::is_secret_account` reads this manifest, so `setConfig` /
  `getConfig` in `app_invoke/core.rs` automatically route the value to the OS
  keychain (via `secure_store`) rather than the SQLite `config` table. No new
  storage code is required.
- **TS config (`src/lib/settingsConfig.ts`):**
  - Add `anthropicApiKey: string` to `GlobalSettingsConfig`.
  - Add `anthropicApiKey: ''` to `DEFAULT_GLOBAL_SETTINGS`.
  - Load `getConfig('anthropic_api_key')` in `loadGlobalSettings` and default to
    the empty string.
- **TS save (`src/lib/settingsSaver.ts`):**
  - Add `anthropicApiKey: string` to `GlobalSettingsSavePayload`.
  - `setConfig('anthropic_api_key', payload.anthropicApiKey)` in
    `saveGlobalSettings`.
- **UI (`src/components/settings/SettingsView.svelte`):**
  - `let anthropicApiKey = $state('')`, hydrate from `globalSettings`, include in
    the save payload, and pass to the credentials card with an
    `onAnthropicApiKeyChange` callback that calls `scheduleSave()` — mirroring
    `githubToken`.
- **UI (`src/components/settings/SettingsCredentialsCard.svelte`):**
  - Add props `anthropicApiKey: string` and
    `onAnthropicApiKeyChange: (value: string) => void`.
  - Add an "Anthropic" section with a `password` input, following the existing
    GitHub layout and daisyUI classes. No hardcoded colors.

The settings renderer already loads the GitHub token secret into a password field
for display; loading the Anthropic key the same way is consistent. The key is
only exposed to the settings renderer, never to plugins.

### 2. Backend — Anthropic client and roadmap Refine rework

- **New module `src-tauri/src/anthropic_client.rs`** (registered in `main.rs`):
  - `pub(crate) async fn refine_ticket_draft(api_key: &str, request: &TicketDraftRequest) -> Result<TicketDraft, String>`:
    1. Build the prompt with `crate::roadmap_ai::build_ticket_draft_prompt(request)`.
    2. POST to `https://api.anthropic.com/v1/messages` using the existing
       `reqwest` dependency, with headers `x-api-key: <key>`,
       `anthropic-version: 2023-06-01`, `content-type: application/json`, and a
       request timeout (reuse the 120s constant style from `roadmap_ai`).
    3. Body: `{ "model": "claude-opus-4-8", "max_tokens": 4096, "messages": [{ "role": "user", "content": <prompt> }] }`.
    4. On non-2xx, return a clear error including the response body detail.
    5. Extract assistant text from `content[]` (concatenate `text` blocks) and
       parse with `crate::roadmap_ai::parse_ticket_draft_output`.
  - **Testable helpers (pure, no network):**
    - `build_messages_request_body(model: &str, max_tokens: u32, prompt: &str) -> serde_json::Value`
    - `extract_response_text(response: &serde_json::Value) -> Result<String, String>`
- **Handler (`src-tauri/src/app_invoke/roadmap.rs`, `roadmap_refine_ticket`):**
  - Remove the project AI-provider resolution and `project_path` lookup.
  - Read the key via `crate::secure_store::get_secret("anthropic_api_key")`;
    treat `None`/empty as "no key" and return
    `bad_request("Anthropic API key required. Add it in Settings → Credentials.")`.
  - Build `TicketDraftRequest` as today (repo, text, draft, feedback, labels) and
    call `anthropic_client::refine_ticket_draft(&key, &request)`.
- **`src-tauri/src/roadmap_ai.rs` cleanup:**
  - Keep: `TicketDraft`, `TicketDraftRequest` (+ `validate`),
    `build_ticket_draft_prompt`, `parse_ticket_draft_output` (and its helpers),
    and their existing tests.
  - Remove: `refine_ticket` (CLI dispatch), `run_codex_headless`,
    `run_claude_headless`, `run_opencode_headless`, `run_headless_command`,
    `resolve_headless_program`, `build_codex_headless_args`,
    `build_claude_headless_args`, `build_opencode_headless_args`, the
    Codex-schema constants, and their now-orphaned tests/imports.

### 3. Availability command

- **New app-invoke command `cloud_ai_status`** (in `app_invoke/core.rs`, or a
  small `app_invoke/cloud_ai.rs` module): returns
  `{ "anthropicKeyPresent": <bool> }` by checking
  `secure_store::get_secret("anthropic_api_key")` for a non-empty value. It never
  returns the key itself. This is the reusable seam future cloud features can
  query.
- **Plugin host exposure:** expose the command to plugins through the existing
  host-command mapping in `plugin_host/callbacks.rs` (the same mechanism that maps
  `roadmapRefineTicket` → `roadmap_refine_ticket`). Implementation must verify how
  host commands are allow-listed/mapped and add `cloudAiStatus` → `cloud_ai_status`.

### 4. Plugin — disable Refine without a key

- **`plugins/roadmap/src/backend.ts`:** register a `roadmap_refine_available`
  method that proxies `cloudAiStatus` and returns `{ available: boolean }`
  (`available = anthropicKeyPresent`).
- **`plugins/roadmap/src/lib/types.ts`:** add the request/response types.
- **`RoadmapView` (and `index.ts` wiring):** fetch availability when the create
  dialog is opened (so a key added in Settings is reflected without a full board
  reload) and pass `aiAvailable` into `CreateDialog`.
- **`plugins/roadmap/src/components/CreateDialog.svelte`:**
  - Add prop `aiAvailable: boolean`.
  - "Refine" (initial) and "Refine with feedback" buttons: add `!aiAvailable` to
    the `disabled` condition and a `title` tooltip
    ("Add an Anthropic API key in Settings to use Refine") when `!aiAvailable`.
  - "Skip AI" and "Create issue" remain enabled regardless of `aiAvailable`.

### 5. Model / configuration

- Model hardcoded to `claude-opus-4-8`. No user-facing model selection in v1.

## Data flow

```
CreateDialog "Refine"
  -> plugin backend roadmap_refine_ticket
  -> host command roadmapRefineTicket
  -> app_invoke/roadmap.rs (reads anthropic_api_key from keychain)
  -> anthropic_client::refine_ticket_draft
       -> POST api.anthropic.com/v1/messages (Claude Opus 4.8)
       -> parse_ticket_draft_output
  -> TicketDraft { title, body } back to the dialog

CreateDialog open
  -> plugin backend roadmap_refine_available
  -> host command cloudAiStatus
  -> app_invoke cloud_ai_status (keychain presence check, boolean only)
  -> aiAvailable enables/disables the Refine buttons
```

## Testing (TDD)

- **Rust**
  - `data_identity`: extend the manifest test to assert
    `is_secret_account("anthropic_api_key")`.
  - `anthropic_client`: unit-test `build_messages_request_body` (model,
    max_tokens, message shape) and `extract_response_text` (happy path,
    missing/empty content, error object). Network call itself is not unit-tested.
  - Response parsing is already covered by `parse_ticket_draft_output` tests
    (reused).
  - Handler behavior "no key → error" verified where practical (unit on the
    key-guard branch or a focused handler test).
- **TypeScript**
  - `settingsConfig` / `settingsSaver`: round-trip `anthropicApiKey`
    (load default + save calls `setConfig('anthropic_api_key', …)`).
  - `CreateDialog`: with `aiAvailable = false`, the Refine buttons are disabled
    (behavioral assertion, not CSS); "Skip AI" remains enabled.

## Verification gates

- Frontend/type changes: `pnpm exec tsc --noEmit` and `pnpm test`.
- Rust sidecar changes: `cargo test` from `src-tauri/`.
- Plugin changes: `pnpm build:plugins` plus targeted plugin tests.

## Trade-offs / alternatives considered

- **Structured outputs vs prompt-and-parse:** the API's strict structured
  outputs would guarantee valid JSON, but the existing ticket schema uses
  `minLength` (rejected by strict structured outputs) and we call raw HTTP from
  Rust (no SDK to strip unsupported constraints). The existing
  `parse_ticket_draft_output` is already robust to fenced/wrapped JSON, so v1 uses
  prompt-for-JSON + parse. Structured outputs is a possible later enhancement.
- **General `cloud_ai_status` vs roadmap-specific availability:** a general
  command is chosen because the key is framed as a reusable feature base; future
  cloud features can query the same seam.

## Follow-up tasks (candidates)

- Optional "Test key" / validation action in settings (a lightweight API ping).
- Structured-outputs upgrade for Refine once a strict-compatible schema is used.
- Reuse the Anthropic client / `cloud_ai_status` seam for additional cloud
  features.
