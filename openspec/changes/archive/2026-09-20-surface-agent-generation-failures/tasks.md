## 1. Classify generation results

- [x] 1.1 Add a failing sidecar test for a structured error envelope returned with a non-zero exit, then preserve process output through classification and verify the provider reason reaches the caller
- [x] 1.2 Add sidecar tests for structured error envelopes on successful exits and non-zero exits without envelopes, then verify envelope errors take precedence and process failures retain their status and non-empty error output
- [x] 1.3 Add sidecar tests for text-format success and non-zero exits with and without error output, then verify the text path remains raw and produces a clean exit-status fallback
- [x] 1.4 Add a sidecar test for successful process output without a usable structured result envelope, then verify it reports the distinct unusable-output error
- [x] 1.5 Add sidecar tests for timeout and abort supervision, then verify their caller-facing messages remain distinct from provider and unusable-output failures

## 2. Record diagnostic outcomes

- [x] 2.1 Emit one classified sidecar outcome for every completed generation attempt and verify tests cover success, provider error, timeout, abort, unusable output, and process failure
- [x] 2.2 Pass generation diagnostic messages through the sidecar formatter and verify the `provider`, `output_mode`, and `generation_outcome` fields survive existing redaction without provider output or prompts entering the log

## 3. Validate the sidecar

- [x] 3.1 Run the focused agent-generation and sidecar-logger tests and verify every specified result and diagnostic outcome passes
- [x] 3.2 Run the full Rust sidecar test and static-check commands required by `CONTRIBUTING.md` and verify the affected subsystem is clean
