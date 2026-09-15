## Why

Headless agent generation reports a failure with no reason in it. A real stored walkthrough failure reads `agent process exited with status exit status: 1: `, with nothing after the colon, so the cause cannot be told apart from authentication, rate limiting, context overflow, or a blocked tool prompt.

The reason is discarded, not missing. The provider CLI reports a non-fatal run failure in its stdout result envelope and can still exit non-zero while leaving stderr empty. `run_child` throws stdout away on any non-zero exit, and `unwrap_json_result_envelope` runs only on a zero exit and only when the caller asked for an output schema.

This is the one primitive every plugin generation passes through, and neither of the two changes that follow repairs it.

## What Changes

- Read the provider result envelope on a non-zero exit status and report the reason it carries, instead of reporting the exit status alone.
- Read the envelope on every structured-output run, not only on a zero exit.
- State what the text-format path reports, which has no envelope to read.
- Report a provider-reported error, a timeout, an abort, and unrecognizable output as distinct outcomes rather than collapsing them into one message.
- Record the classified outcome of each generation attempt in the sidecar log, using field names that existing log redaction does not scrub to nothing.

Out of scope, deliberately:

- The plugin-side walkthrough cache, its error copy, and the pull request list row that drops the message. `add-pr-review-agent-session` replaces that path.
- A generation row stranded in `generating` when a setup step throws. Tracked as KVG-2228.
- A null project id rejected as a bad request in the all-repos view. Tracked as KVG-2230.

## Capabilities

### New Capabilities

- `agent-generation-diagnostics`: what a headless agent generation reports when it fails, times out, is aborted, or returns output the caller cannot use.

### Modified Capabilities

None. No existing spec states how a generation failure is reported.

## Impact

- Rust sidecar headless generation: envelope handling on the non-zero exit path, outcome classification, and the text-format path that has no envelope.
- Sidecar logging for the generation path, which today logs only a credential warning.
- Sidecar log redaction, which scrubs any field whose name contains `stdout`, `stderr`, `path`, `url`, `body`, or `prompt`.
- Sidecar tests for each generation outcome.
