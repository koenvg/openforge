# PR review: Jira ticket gap analysis

## Problem

The Walkthrough + AI review starts from the pull request. But the pull request is an
outcome of a Jira ticket, and the ticket is the source of truth for what should have
been built. Nothing in the current flow reads it.

A human reviewer closes this gap by opening the ticket before reading the diff, then
asking "did they build all of this?". OpenForge cannot ask that question, so a
requirement that was never implemented is indistinguishable from one that was — the
review is internally consistent and still misses the thing that matters.

This design adds a preliminary step: resolve and fetch the PR's Jira ticket, feed it to
the same agent that produces the walkthrough, and report per-criterion coverage of the
ticket by the PR.

## Where the code lives

| Concern | File |
| --- | --- |
| Walkthrough trigger, prompt assembly | `plugins/github-sync/src/backend.ts` (`startAgentWalkthrough`) |
| Prompt template | `plugins/github-sync/src/lib/walkthroughPrompt.md` (mirrored at `src/lib/prWalkthroughPrompt.md`) |
| Prompt compilation | `plugins/github-sync/src/lib/walkthroughPrompt.ts` |
| Agent output schema | `plugins/github-sync/src/lib/walkthroughSchema.ts` |
| Persist + session guard | `plugins/github-sync/src/lib/walkthroughStore.ts` |
| Output validation | `plugins/github-sync/src/lib/walkthroughParse.ts`, `reviewCommentsParse.ts` |
| Step indexing | `plugins/github-sync/src/lib/walkthroughViewState.ts` |
| Rendering | `plugins/github-sync/src/review/pr/WalkthroughTab.svelte` |
| Host command allowlist | `src-tauri/src/plugin_host/command_callbacks.rs` |
| Headless agent runner | `src-tauri/src/app_invoke/agent_generate.rs` |
| Keychain | `src-tauri/src/secure_store.rs`, `openforge-data-identity.json` |

## Key facts this design relies on

Verified against the tree, not assumed:

1. `openforge.settings.registerSection({ scope: 'global' })` renders a plugin-owned
   section inside that plugin's own card on the global settings page. Disabling the
   plugin removes it.
2. Plugin-only host commands need an entry in `command_callbacks.rs` and a handler under
   `app_invoke/`, and nothing else. They do **not** appear in `src/lib/ipc.ts`,
   `electronMigrationContracts.ts`, or `src/electron/backendBridge.ts` —
   `agent_generate_in_repo` is the existing proof.
3. `plugin_may_invoke_command` already denies every plugin except
   `com.openforge.github-sync`, so new commands inherit that gate.
4. `secure_store` exposes `get_secret_async` / `set_secret_async` /
   `delete_secret_async`, admitting only keys listed in `dataIdentity.keychain.secretAccounts`
   in `openforge-data-identity.json`. `github_token` is the precedent.
5. `extractWalkthroughStepsJson` persists `JSON.stringify(parsed)` of the *whole* agent
   object, not just `steps`. A third top-level key is stored with no storage change.
6. `walkthroughPrompt.md` is held byte-identical to `src/lib/prWalkthroughPrompt.md` by
   `src/lib/prWalkthroughPrompt.test.ts`.
7. `compileWalkthroughPrompt` substitutes with `String.prototype.replace`, so a
   placeholder missing from a user-overridden template is a silent no-op rather than an
   error.
8. `WalkthroughTab` already renders one synthetic step — the trailing "Review & submit"
   step at index `steps.length`, kept out of `parsedSteps` so it never reaches
   validation.
9. Repo-aware generations hold a global semaphore of 2 and a 600s timeout, and each one
   creates and destroys a PR-head worktree. Adding a second generation per review is
   expensive; adding output to the existing one is not.

## Changes

### 1. Core: Jira access behind the keychain

Add `jira_api_token` to `secretAccounts` in `openforge-data-identity.json`. The token
gets the same protection `github_token` has.

New `src-tauri/src/jira_runtime/`:

- `client.rs` — `reqwest`, HTTP Basic auth over `email:token`, calling
  `GET {baseUrl}/rest/api/3/issue/{key}?fields=summary,description,status,issuetype`,
  plus the configured acceptance-criteria custom field when one is set.
- `adf.rs` — Atlassian Document Format to plain text. Jira Cloud's v3 API returns
  `description` as ADF, so this is required even though no custom field is read: walk the
  node tree, collect `text` from leaves, emit a newline after block nodes (`paragraph`,
  `heading`, `listItem`, `hardBreak`), and prefix list items with `- `.

New `src-tauri/src/app_invoke/jira.rs` plus a `GlobalCommandHandler::Jira` variant in
`command_callbacks.rs`, exposing:

| Host command | App command | Purpose |
| --- | --- | --- |
| `setJiraApiToken` | `set_jira_api_token` | Write the token to the keychain |
| `clearJiraApiToken` | `clear_jira_api_token` | Delete it |
| `getJiraApiTokenStatus` | `get_jira_api_token_status` | `{ configured: bool }` — never returns the token |
| `testJiraConnection` | `test_jira_connection` | `GET /rest/api/3/myself`, surfaces the account name |
| `fetchJiraWorkItem` | `fetch_jira_work_item` | Takes `{ baseUrl, email, issueKey }`, reads the token itself, returns the flattened work item |

The token crosses into the plugin exactly once, when the settings form writes it. Reads
never leave Rust: `fetch_jira_work_item` pulls the secret internally, so the plugin
backend never holds Jira credentials.

### 2. Plugin: Jira settings section

Add `"settings"` to `requires` in `plugins/github-sync/package.json`, then:

```ts
openforge.settings.registerSection({
  id: 'jira',
  title: 'Jira',
  scope: 'global',
  component: JiraSettingsSection,
})
```

Fields: **Base URL**, **Email**, **API token** (masked; renders as *Configured* with a
Clear action once set, never re-displayed), **Acceptance criteria field** (optional,
e.g. `customfield_12100`), **Project keys** (optional, comma-separated), and a
**Test connection** button.

Non-secret values go to `openforge.storage.global` under `jira:config`, so they are
plugin-owned and disappear with the plugin. Only the token lives in core.

Project keys are not cosmetic. A bare `[A-Z][A-Z0-9]+-\d+` scan matches `UTF-8` in a PR
title. With keys configured (`AVIV,KVG`) detection is exact; without them it falls back
to the pattern plus a denylist.

### 3. Ticket resolution

`resolveJiraKey(pr, config, override)` in a new `plugins/github-sync/src/lib/jiraKey.ts`,
first match wins in this order:

1. Manual override stored at `jira:key:{prId}`
2. `pr.head_ref`
3. `pr.title`
4. `pr.body`

Keyed by PR id rather than head SHA — the ticket does not change when a new commit lands.

With `projectKeys` configured, only those prefixes match. Without, the pattern
`\b([A-Z][A-Z0-9]{1,9})-\d+\b` applies minus a denylist of `UTF`, `ISO`, `RFC`, `SHA`,
`HTTP`, `HTTPS`, `TLS`, `SSL`, `UTC`, `IPV`, `CVE`, `ASCII`, `API`, `SQL`, `AWS`, `GCP`,
`X86`, `ARM`, `MD5`, `EOL`.

### 4. Prompt and schema

`compileWalkthroughPrompt` takes an optional `ticket` and fills two new placeholders,
both following the `{{PR_DESCRIPTION}}` pattern — regex-replaced including the trailing
newline, and expanded to an empty string when there is no ticket:

- `{{JIRA_TICKET}}`, near the top, carrying the ticket the diff is judged against.
- `{{TICKET_COVERAGE_OUTPUT}}`, in the output-format section, carrying the
  `ticket_coverage` contract.

Two placeholders rather than one so the ticket stays where the agent reads it first while
the output contract stays with the other output contracts. Both are filled or both are
empty; there is no state where one appears without the other.

Template block:

```
## Source Ticket

This PR implements Jira ticket {{KEY}}. The ticket is the source of truth for what
should have been built; the diff is only an attempt at it.

**Summary:** {{SUMMARY}}
**Type:** {{TYPE}}   **Status:** {{STATUS}}

### Description

{{DESCRIPTION}}

Read the ticket before you analyse the diff. Enumerate every acceptance criterion it
states, in full, before judging any of them. If the description has an explicit
"Acceptance Criteria" section, use exactly those items. Otherwise derive the functional
requirements from the description and summary.
```

And an output block describing `ticket_coverage` as a third top-level key alongside
`steps` and `review_comments`:

```json
{
  "ticket_coverage": {
    "verdict": "partial",
    "summary": "2–3 sentences on whether the PR delivers the ticket.",
    "criteria": [
      {
        "id": "ac-1",
        "text": "Verbatim criterion as stated in the ticket.",
        "status": "covered",
        "evidence": [{ "filename": "src/foo.ts", "note": "Why this satisfies it." }],
        "notes": "Required when status is not 'covered'."
      }
    ],
    "out_of_scope": [
      { "description": "Functional change the ticket does not ask for.", "files": ["src/bar.ts"] }
    ]
  }
}
```

Enums, enforced by the schema and re-checked by the parser: `verdict` is one of
`complete` | `partial` | `missing` | `unassessable`; `status` is one of `covered` |
`partial` | `missing` | `unclear`.

`out_of_scope` carries an explicit narrowing rule in the prompt, because the default
model behaviour here is to list every refactor it sees:

- Only functional, user-observable behaviour not called for by the ticket.
- Never refactors, renames, file moves, test additions, dependency bumps, formatting,
  type-only changes, logging, or performance work that does not change behaviour.
- The test: would a user or QA notice this change? If not, it does not belong here.

`walkthroughSchema.ts` gains a second constant,
`WALKTHROUGH_REVIEW_TICKET_JSON_SCHEMA`, identical to the existing one plus a required
`ticket_coverage`. The backend picks the schema by whether ticket context was injected,
which leaves the no-Jira path byte-identical to today.

### 5. Storage and parsing

Plugin storage, global scope:

| Key | Value |
| --- | --- |
| `jira:config` | `{ baseUrl, email, projectKeys, acFieldId }` |
| `jira:key:{prId}` | Manual override `{ issueKey }` |
| `jira:ticket:{prId}:{headSha}` | `{ issueKey, url, summary, status, issueType, description, fetchedAt, error }` |

Coverage itself needs no key: it rides inside `steps_json` (fact 5).

New `plugins/github-sync/src/lib/ticketCoverageParse.ts` follows the drop-don't-reject
discipline `walkthroughParse.ts` established. Evidence filenames absent from the live
diff are dropped; a criterion whose evidence all drops keeps its verdict but shows no
files; unknown `status` or `verdict` values are dropped rather than rendered. Malformed
coverage yields `null` and the ticket step falls back to showing the ticket alone.

### 6. UI: a synthetic first step

The ticket step is unconditional. Gating it on Jira being configured was the original
design and it was wrong in practice: a reviewer with no Jira connection saw no ticket
step, no coverage, and nothing explaining either. The step is the only place that can
carry that explanation, so it always renders and reports one of four states:

| State | What it says |
| --- | --- |
| Jira not connected | How to connect it, and that a regenerate is needed afterwards |
| Connected, no snapshot | This walkthrough predates the connection; offers Regenerate |
| Connected, no key resolved | No ticket found, with the key input |
| Ticket fetched | The ticket, the verdict, and the criteria |

The third and fourth states also carry the key input so a wrong detection can be
corrected.

One scoping consequence: the step navigator only renders once a walkthrough has produced
at least one valid step, so the ticket step inherits that condition. When walkthrough
generation itself fails, the reviewer sees the existing "couldn't be aligned with the
current diff" state rather than a ticket step. The gap analysis rides with the
walkthrough; it does not replace it.

The ticket step renders the ticket header (key, summary, type, status, link out), the
verdict chip and summary, each criterion with its status and evidence files, and the
`out_of_scope` list when non-empty.

Adding a *leading* synthetic step shifts every index in `walkthroughViewState.ts` —
`totalWalkthroughSteps`, `isReviewSubmitStep`, `clampStepIndex` — plus the keyboard
navigation and `buildSyntheticStepFiles` call sites in `WalkthroughTab.svelte`. Rather
than adjust five pieces of off-by-one arithmetic, replace them with one function:

```ts
type WalkthroughStepEntry =
  | { kind: 'ticket' }
  | { kind: 'concept'; step: PrWalkthroughStep }
  | { kind: 'submit' }

function buildWalkthroughStepList(
  steps: PrWalkthroughStep[],
  hasTicketStep: boolean,
): WalkthroughStepEntry[]
```

The tab then indexes a list and switches on `kind`. `isReviewSubmitStep` and
`totalWalkthroughSteps` are deleted; `clampStepIndex` stays. This is contained to code
the change already has to touch.

### 7. Degradation

The gap analysis is strictly additive. It must never fail a walkthrough that would
otherwise have succeeded.

| Situation | Behaviour |
| --- | --- |
| Jira not configured | Prompt and schema identical to today. The ticket step still renders, saying Jira is not connected. |
| Configured, no key resolved | Ticket step renders with a manual-entry field; walkthrough and review generate without ticket context. |
| Fetch fails (401 / 404 / network) | Error persisted on the ticket snapshot; step shows it with a retry; walkthrough and review still generate. |
| Agent omits or mangles `ticket_coverage` | Step shows the ticket and a regenerate action. The walkthrough is **not** marked errored. |

Setting a manual key re-runs the existing regenerate path for the current head SHA.

## Non-goals and guardrails

- No writes to Jira. Read-only, and no scope to post the analysis back to the ticket.
- No new agent run. One repo-aware generation per review, as today (fact 9).
- The read-only tool policy in `agent_generate.rs` is unchanged. The ticket arrives in
  the prompt; the agent is not given network or CLI access to fetch it.
- `PrWalkthrough` and the SDK's `domain.ts` are untouched. Nothing outside the plugin
  consumes the ticket or coverage types, so they stay local to the plugin.
- Exactly one custom field is read, and only when its id is configured. Everything else
  is `summary`, `description`, `status`, and `issuetype`.

### Acceptance criteria come from a custom field first

The criteria are read in this order:

1. The configured acceptance-criteria custom field (`acFieldId`, e.g.
   `customfield_12100`). When it has content, the prompt presents it as the
   authoritative list and tells the agent to judge against exactly those items and add
   nothing.
2. An explicit "Acceptance Criteria" section in the description. `adf_to_text` renders
   ADF headings as markdown precisely so this section stays recognisable.
3. Failing both, the functional requirements the agent derives from the description and
   summary.

The field id is per-instance configuration, not a constant, so nothing here is tied to
one Jira. With no id configured the request is the base four fields and behaviour is
unchanged.

### Known limitation

The agent still enumerates the individual criteria itself; we hand it the field's text
rather than a numbered list with ids it must answer against. So a criterion it silently
skips is undetectable — we cannot tell "the field listed four requirements and it judged
three" from "it listed three". The mitigations are prompt-side (work through them one at
a time) and presentational (the raw acceptance-criteria text renders verbatim above the
verdicts, so the reviewer can compare). Splitting the field into numbered criteria with
stable ids and requiring one verdict per id would close this, at the cost of a split
heuristic that can mis-group multi-line criteria.

## Testing strategy

Business logic, per the repo's TDD convention:

- `jiraKey.test.ts` — precedence across override / branch / title / body; `UTF-8` and
  `ISO-8601` rejected by the denylist; `projectKeys` restricting matches; no key found.
- `adf.rs` — flattening paragraphs, headings, nested lists, hard breaks; empty and
  absent descriptions; non-ADF payloads.
- `ticketCoverageParse.test.ts` — evidence filenames not in the diff dropped; unknown
  status dropped; malformed input yields `null`; well-formed input round-trips.
- `walkthroughViewState.test.ts` — `buildWalkthroughStepList` index mapping with and
  without the ticket step, and with zero concept steps.
- `walkthroughPrompt.test.ts` — ticket block injected when present, elided when absent,
  and a no-op against a user template lacking `{{JIRA_TICKET}}`.
- `walkthroughSchema` — the no-ticket path still uses the original schema.
- Rust — `jira_api_token` is a recognised secret account; the new host commands resolve;
  unknown commands still reject.

Both copies of the prompt template change together or `prWalkthroughPrompt.test.ts`
fails CI (fact 6).

## Out of scope

- Linear, GitHub Issues, or any non-Jira tracker.
- Posting the coverage analysis to the PR or the ticket.
- Bulk or background coverage analysis across the PR list.
- Jira OAuth. Email plus API token only.
