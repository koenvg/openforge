## Context

See `proposal.md` for the user-facing failure. The generation code currently converts child-process completion directly into `Result<String, String>`. That conversion discards standard output on a non-zero exit, before the structured result envelope can be inspected. Envelope handling then runs only for a successful process and passes unrecognized structured output through as if it were usable.

The same function owns structured and text output, timeouts, aborts, process failures, and sidecar diagnostics. The logger removes values attached to sensitive field names such as `stdout`, `stderr`, `body`, `path`, and `prompt`.

## Goals / Non-Goals

**Goals:**

- Preserve child completion data until output mode and provider envelope semantics have been applied.
- Give every terminal generation state one classification, one caller-facing result, and one sidecar outcome diagnostic.
- Keep the existing command boundary as `Result<String, String>`.

**Non-Goals:**

- Expose a new typed failure contract over IPC.
- Log provider output or error reasons.
- Change the plugin walkthrough cache or UI copy outside the returned generation error.

## Decisions

### Classify after process supervision

Process supervision will return an internal execution outcome instead of immediately converting every terminal state into a string result. A separate classifier will combine that execution outcome with the requested output mode.

This preserves the exit status, standard output, and standard error until structured envelope inspection has run. It also puts provider errors, timeouts, aborts, unusable output, process failures, and success behind one internal type. The command boundary converts the classified outcome back to the existing `Result<String, String>`.

The alternative was to special-case non-zero exits inside the current `run_child` error branch. That would repair the reported bug but leave timeout, abort, unusable output, and logging classification spread across separate branches.

### Inspect structured envelopes before interpreting exit status

For structured runs, the classifier will inspect standard output for a result envelope on every completed process. An error envelope wins over the process status and returns its `result` reason. A successful envelope returns model text only when the process also exited successfully. A non-zero exit without an error envelope remains a process failure.

A zero exit without a recognizable successful envelope and result text is unusable structured output. It will no longer pass through as successful raw output. A non-zero exit without an envelope falls back to the exit status and preserves non-empty standard error.

The text path will not inspect envelopes. It returns raw standard output on success. On a non-zero exit it reports the status and non-empty standard error, with a clean status-only fallback when standard error is empty.

The alternative was to parse any JSON-looking text even in text mode. That would make caller behavior depend on model content rather than the selected provider output format.

### Log the final classification once

The generation boundary will emit one info-level sidecar diagnostic after classification. It will use the fields `provider`, `output_mode`, and `generation_outcome`. Those names do not match the logger's sensitive-field redaction rules. Values will be bounded labels such as `success`, `provider_error`, `timed_out`, `aborted`, `unusable_output`, and `process_failure`.

The diagnostic will not include prompts, standard output, standard error, envelope reasons, repository identity, or working directories. Tests will pass the generated diagnostic through the real sidecar formatter to prove its fields survive redaction.

The alternative was to log each process branch independently. That risks missing branches and emitting more than one outcome for an attempt.

### Test classification through internal behavior boundaries

Focused sidecar tests will exercise the classifier with process completions and exercise process supervision for timeout and abort behavior. Tests will cover error envelopes on both zero and non-zero exits, process fallback without an envelope, text-mode failure behavior, unusable structured output, and every logged outcome label.

Tests will assert caller-visible results and formatted diagnostics, not private parsing steps.

## Risks / Trade-offs

- [A provider version emits a new structured shape] -> Report it as unusable output on a zero exit instead of returning data that structured callers cannot safely consume. Tests make the compatibility boundary explicit.
- [Provider error text contains sensitive data] -> Return it to the requesting caller but never copy it into the sidecar outcome diagnostic.
- [The internal outcome type adds branches] -> Keep conversion to the public `Result<String, String>` in one classifier and make exhaustive matching enforce coverage.

## Migration Plan

No stored data or public payload changes are required. Deploy the sidecar change with its tests. Rollback restores the previous error reporting and does not require data migration.
